const test = require('node:test');
const assert = require('node:assert/strict');

const Lifecycle = require('../reader-resume-lifecycle.js');

function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        value(key) { return values.get(key); },
    };
}

function bookshelfPrototype() {
    return {
        normalizeBook(book) {
            return {
                id: book.book_id || book.id,
                name: book.book_title || book.name,
                categoryId: book.category_id || book.categoryId || 'uncategorized',
                status: book.status || 'ready',
            };
        },
        setLoading(value, message) {
            this.loadingEvents.push({ value, message });
        },
        ensureCategoryIntegrity() { this.integrityCalls += 1; },
        renderCategories() { this.categoryRenderCalls += 1; },
        renderBooks() { this.bookRenderCalls += 1; },
    };
}

function bookshelfInstance(prototype) {
    const instance = Object.create(prototype);
    instance.books = [];
    instance.loadingEvents = [];
    instance.integrityCalls = 0;
    instance.categoryRenderCalls = 0;
    instance.bookRenderCalls = 0;
    return instance;
}

test('bookshelf resolves the same configured API base as Reader v2', () => {
    const root = {
        API_BASE_URL_OVERRIDE: 'https://example.test/api/',
        ReaderApiV2: {
            resolveBaseUrl(value) {
                return String(value.API_BASE_URL_OVERRIDE).replace(/\/+$/, '');
            },
        },
    };
    assert.equal(Lifecycle.resolveBookshelfBaseUrl(root), 'https://example.test/api');
});

test('successful bookshelf load caches normalized non-processing books', async () => {
    const storage = memoryStorage();
    const prototype = bookshelfPrototype();
    const urls = [];
    Lifecycle.installBookshelfResilience(prototype, {
        storage,
        resolveBaseUrl: () => 'https://backend.test',
        fetchImpl: async (url) => {
            urls.push(url);
            return {
                ok: true,
                async json() {
                    return {
                        books: [
                            { book_id: 'ready', book_title: 'Ready', status: 'completed' },
                            { book_id: 'busy', book_title: 'Busy', status: 'processing' },
                        ],
                    };
                },
            };
        },
    });
    const instance = bookshelfInstance(prototype);

    await instance.loadBooksFromBackend();

    assert.deepEqual(urls, ['https://backend.test/api/v1/books']);
    assert.deepEqual(instance.books.map((book) => book.id), ['ready']);
    assert.deepEqual(
        JSON.parse(storage.value(Lifecycle.BOOKSHELF_CACHE_KEY)).map((book) => book.id),
        ['ready'],
    );
    assert.equal(instance.bookRenderCalls, 1);
    assert.equal(instance.loadingEvents.at(-1).value, false);
});

test('failed bookshelf load restores the most recent cached list instead of clearing it', async () => {
    const cached = [{ id: 'cached', name: 'Cached book', categoryId: 'uncategorized', status: 'completed' }];
    const storage = memoryStorage({
        [Lifecycle.BOOKSHELF_CACHE_KEY]: JSON.stringify(cached),
    });
    const prototype = bookshelfPrototype();
    Lifecycle.installBookshelfResilience(prototype, {
        storage,
        resolveBaseUrl: () => 'https://backend.test',
        fetchImpl: async () => { throw new Error('offline'); },
    });
    const instance = bookshelfInstance(prototype);

    await instance.loadBooksFromBackend();

    assert.deepEqual(instance.books.map((book) => book.id), ['cached']);
    assert.equal(instance.bookRenderCalls, 1);
    assert.match(instance.loadingEvents.at(-1).message, /显示最近书单/);
});

test('failed refresh preserves books already held in memory', async () => {
    const prototype = bookshelfPrototype();
    Lifecycle.installBookshelfResilience(prototype, {
        storage: memoryStorage(),
        fetchImpl: async () => ({ ok: false, status: 503 }),
        resolveBaseUrl: () => 'https://backend.test',
    });
    const instance = bookshelfInstance(prototype);
    instance.books = [{ id: 'existing', name: 'Existing', categoryId: 'uncategorized' }];

    await instance.loadBooksFromBackend();

    assert.deepEqual(instance.books.map((book) => book.id), ['existing']);
    assert.match(instance.loadingEvents.at(-1).message, /显示最近书单/);
});
