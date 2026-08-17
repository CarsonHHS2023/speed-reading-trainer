const test = require('node:test');
const assert = require('node:assert/strict');

const AppAccess = require('../app-access.js');
const UploadLifecycle = require('../bookshelf-upload-lifecycle.js');
const ResumeLifecycle = require('../reader-resume-lifecycle.js');

const PROD_BASE = 'https://carsonhhs-pdf-ocr-service.hf.space';

function makeStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
        values,
    };
}

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return body; },
    };
}

function makeProcessingDocument() {
    const ids = [
        'processingPanel',
        'processingBookName',
        'processingStatus',
        'processingPercent',
        'processingBarFill',
        'processingPageInfo',
    ];
    const elements = Object.fromEntries(ids.map((id) => [id, {
        id,
        textContent: '',
        className: '',
        style: {},
    }]));
    return {
        elements,
        getElementById(id) { return elements[id] || null; },
    };
}

function immediateTimer(callback) {
    callback();
    return 0;
}

test('authenticated FormData upload preserves the body and adds only the Bearer header', async () => {
    const calls = [];
    const root = {
        URL,
        Headers,
        location: { href: 'https://carsonhhs2023.github.io/speed-reading-trainer/' },
        sessionStorage: makeStorage(),
    };
    const controller = AppAccess.createController(root, {
        fetchImpl: async (input, init = {}) => {
            calls.push({ input, init });
            return jsonResponse({ status: 'processing', book_id: 'book-new' });
        },
    });
    controller.setToken('signed-development-token');

    const formData = new FormData();
    formData.append('file', 'book contents');
    await controller.authenticatedFetch(`${PROD_BASE}/api/v1/upload`, {
        method: 'POST',
        body: formData,
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body, formData);
    assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer signed-development-token');
    assert.equal(new Headers(calls[0].init.headers).get('content-type'), null);
});

test('401 stops book-status polling immediately instead of leaving an infinite retry loop', async () => {
    let calls = 0;
    const documentObject = makeProcessingDocument();
    const poll = UploadLifecycle.createBookStatusPoller({
        apiBaseUrl: PROD_BASE,
        documentObject,
        fetchImpl: async () => {
            calls += 1;
            return jsonResponse({ detail: 'Authentication required' }, 401);
        },
        setTimeoutImpl: immediateTimer,
        consoleObject: { error() {} },
        intervalMs: 0,
    });

    const result = await poll('book-new', 'New Book', 10);

    assert.equal(calls, 1);
    assert.equal(result.status, 'authentication_required');
    assert.equal(result.error_code, 'authentication_required');
    assert.match(documentObject.elements.processingStatus.textContent, /登录已失效/);
});

test('transient polling failures are bounded but recover when the backend returns before the limit', async () => {
    const documentObject = makeProcessingDocument();
    let calls = 0;
    const poll = UploadLifecycle.createBookStatusPoller({
        apiBaseUrl: PROD_BASE,
        documentObject,
        fetchImpl: async () => {
            calls += 1;
            if (calls === 1) return jsonResponse({ detail: 'temporary' }, 503);
            return jsonResponse({ book_id: 'book-new', book_title: 'New Book', status: 'completed' });
        },
        setTimeoutImpl: immediateTimer,
        consoleObject: { error() {} },
        intervalMs: 0,
        maxConsecutiveFailures: 3,
    });

    const result = await poll('book-new', 'New Book', 10);

    assert.equal(calls, 2);
    assert.equal(result.status, 'completed');
});

test('transient polling failures stop after the configured consecutive retry limit', async () => {
    const documentObject = makeProcessingDocument();
    let calls = 0;
    const poll = UploadLifecycle.createBookStatusPoller({
        apiBaseUrl: PROD_BASE,
        documentObject,
        fetchImpl: async () => {
            calls += 1;
            return jsonResponse({ detail: 'temporary' }, 503);
        },
        setTimeoutImpl: immediateTimer,
        consoleObject: { error() {} },
        intervalMs: 0,
        maxConsecutiveFailures: 3,
    });

    const result = await poll('book-new', 'New Book', 10);

    assert.equal(calls, 3);
    assert.equal(result.status, 'polling_unavailable');
    assert.equal(result.error_code, 'polling_retry_exhausted');
});

test('completed single upload is immediately persisted for later bookshelf fallback', async () => {
    const localStorage = makeStorage();
    const prototype = {
        async handleFileUpload() {
            this.books.unshift({ id: 'book-new', name: 'New Book', status: 'completed' });
            this.renderBooks();
        },
        renderBooks() {
            this.renderCount += 1;
        },
    };

    UploadLifecycle.installCachePersistence(prototype, {
        storage: localStorage,
        writeCachedBooks: ResumeLifecycle.writeCachedBooks,
        rootObject: {},
    });

    const shelf = Object.create(prototype);
    shelf.books = [{ id: 'book-old', name: 'Old Book', status: 'completed' }];
    shelf.renderCount = 0;

    await shelf.handleFileUpload({ name: 'new.pdf' });
    shelf.books = [];
    const fallbackBooks = ResumeLifecycle.readCachedBooks(localStorage);

    assert.deepEqual(fallbackBooks.map((book) => book.id), ['book-new', 'book-old']);
    assert.equal(shelf.renderCount, 1);
});

test('multi-file completions keep updating the cache even after the upload handler has returned', async () => {
    const localStorage = makeStorage();
    let finishSecondUpload;
    const secondUploadFinished = new Promise((resolve) => { finishSecondUpload = resolve; });
    const prototype = {
        async handleMultiFileUpload() {
            Promise.resolve().then(() => {
                this.books.unshift({ id: 'book-a', name: 'Book A', status: 'completed' });
                this.renderBooks();
                this.books.unshift({ id: 'book-b', name: 'Book B', status: 'completed' });
                this.renderBooks();
                finishSecondUpload();
            });
        },
        renderBooks() {},
    };

    UploadLifecycle.installCachePersistence(prototype, {
        storage: localStorage,
        writeCachedBooks: ResumeLifecycle.writeCachedBooks,
        rootObject: {},
    });

    const shelf = Object.create(prototype);
    shelf.books = [{ id: 'book-old', name: 'Old Book', status: 'completed' }];

    await shelf.handleMultiFileUpload([]);
    await secondUploadFinished;
    const fallbackBooks = ResumeLifecycle.readCachedBooks(localStorage);

    assert.deepEqual(fallbackBooks.map((book) => book.id), ['book-b', 'book-a', 'book-old']);
});

test('login → FormData upload → authenticated polling → completed render leaves the new book in fallback cache', async () => {
    const localStorage = makeStorage();
    const documentObject = makeProcessingDocument();
    const transportCalls = [];
    let pollCount = 0;

    const root = {
        URL,
        Headers,
        location: { href: 'https://carsonhhs2023.github.io/speed-reading-trainer/' },
        sessionStorage: makeStorage(),
        localStorage,
        document: documentObject,
        setTimeout: immediateTimer,
        console: { error() {}, warn() {} },
    };

    const controller = AppAccess.createController(root, {
        fetchImpl: async (input, init = {}) => {
            const url = String(input);
            transportCalls.push({ url, init });
            if (url.endsWith('/api/v1/upload')) {
                return jsonResponse({
                    book_id: 'book-new',
                    book_title: 'New Book',
                    pages_count: 12,
                    status: 'processing',
                });
            }
            if (url.endsWith('/api/v1/books/book-new')) {
                pollCount += 1;
                if (pollCount === 1) return jsonResponse({ book_id: 'book-new', status: 'processing', progress: 50 });
                return jsonResponse({
                    book_id: 'book-new',
                    book_title: 'New Book',
                    file_type: 'pdf',
                    status: 'completed',
                });
            }
            throw new Error(`Unexpected URL: ${url}`);
        },
    });
    controller.setToken('signed-development-token');
    root.fetch = controller.authenticatedFetch;

    const prototype = {
        async handleFileUpload(file) {
            const formData = new FormData();
            formData.append('file', file.name);
            const response = await root.fetch(`${PROD_BASE}/api/v1/upload`, {
                method: 'POST',
                body: formData,
            });
            const result = await response.json();
            const finalBook = await this._pollBookStatus(result.book_id, result.book_title, result.pages_count);
            if (finalBook.status === 'completed') {
                this.books.unshift({ id: finalBook.book_id, name: finalBook.book_title, status: finalBook.status });
                this.renderBooks();
            }
        },
        renderBooks() {},
    };

    UploadLifecycle.install(root, {
        prototype,
        storage: localStorage,
        writeCachedBooks: ResumeLifecycle.writeCachedBooks,
        intervalMs: 0,
        setTimeoutImpl: immediateTimer,
        maxConsecutiveFailures: 3,
        consoleObject: root.console,
    });

    const shelf = Object.create(prototype);
    shelf.books = [{ id: 'book-old', name: 'Old Book', status: 'completed' }];
    await shelf.handleFileUpload({ name: 'new.pdf' });

    assert.equal(transportCalls.length, 3);
    for (const call of transportCalls) {
        assert.equal(new Headers(call.init.headers || {}).get('authorization'), 'Bearer signed-development-token');
    }
    assert.equal(transportCalls[0].init.method, 'POST');
    assert.ok(transportCalls[0].init.body instanceof FormData);
    assert.equal(new Headers(transportCalls[0].init.headers).get('content-type'), null);

    shelf.books = [];
    const fallbackBooks = ResumeLifecycle.readCachedBooks(localStorage);
    assert.deepEqual(fallbackBooks.map((book) => book.id), ['book-new', 'book-old']);
});
