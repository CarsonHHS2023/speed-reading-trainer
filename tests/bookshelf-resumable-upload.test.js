const test = require('node:test');
const assert = require('node:assert/strict');

const Resumable = require('../bookshelf-resumable-upload.js');

function response(status, payload = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return payload; },
    };
}

function root(environment = 'staging') {
    return {
        SPEED_READING_CONFIG: {
            environment,
            apiBaseUrl: 'https://staging.example.test',
        },
        READER_API_BASE_URL: 'https://staging.example.test',
        location: { href: 'https://reader.example.test/staging/' },
        URL,
        console: { info() {}, warn() {} },
        setTimeout,
        clearTimeout,
        AbortController,
        document: {
            getElementById() { return null; },
        },
    };
}

function fakeFile(size = 10) {
    return {
        name: 'large.pdf',
        type: 'application/pdf',
        size,
        slice(start, end) {
            return { start, end, size: end - start };
        },
    };
}

function formWith(file) {
    return {
        get(name) { return name === 'file' ? file : null; },
    };
}

test('large staging upload is transparently split into upload-session chunks', async () => {
    const calls = [];
    const complete = response(200, { status: 'processing', book_id: 'book-1' });
    const fetchImpl = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (calls.length === 1) {
            return response(200, {
                upload_id: '0123456789abcdef0123456789abcdef',
                chunk_size_bytes: 4,
                chunk_count: 3,
                byte_size: 10,
            });
        }
        if (String(url).endsWith('/complete')) return complete;
        return response(200, {});
    };
    const rootObject = root();
    const wrapped = Resumable.createResumableFetch(rootObject, {
        fetchImpl,
        thresholdBytes: 5,
    });

    const result = await wrapped('https://carsonhhs-pdf-ocr-service.hf.space/api/v1/upload', {
        method: 'POST',
        body: formWith(fakeFile()),
    });

    assert.equal(result, complete);
    assert.equal(calls.length, 5);
    assert.equal(calls[0].url, 'https://staging.example.test/api/v1/upload-sessions');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(
        calls.slice(1, 4).map((call) => call.init.body),
        [
            { start: 0, end: 4, size: 4 },
            { start: 4, end: 8, size: 4 },
            { start: 8, end: 10, size: 2 },
        ],
    );
    assert.equal(
        calls[4].url,
        'https://staging.example.test/api/v1/upload-sessions/0123456789abcdef0123456789abcdef/complete',
    );
});

test('small staging upload preserves the legacy multipart request', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return response(200, { status: 'processing' });
    };
    const rootObject = root();
    const wrapped = Resumable.createResumableFetch(rootObject, {
        fetchImpl,
        thresholdBytes: 20,
    });
    const body = formWith(fakeFile(10));

    await wrapped('https://backend.test/api/v1/upload', { method: 'POST', body });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.body, body);
});

test('production environment never enables the staging resumable protocol', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return response(200, {});
    };
    const rootObject = root('production');
    const wrapped = Resumable.createResumableFetch(rootObject, {
        fetchImpl,
        thresholdBytes: 1,
    });

    await wrapped('https://backend.test/api/v1/upload', {
        method: 'POST',
        body: formWith(fakeFile(100)),
    });

    assert.equal(calls.length, 1);
});

test('failed chunk is retried and then aborts the upload session', async () => {
    const urls = [];
    let chunkAttempts = 0;
    const fetchImpl = async (url) => {
        urls.push(String(url));
        if (urls.length === 1) {
            return response(200, {
                upload_id: 'fedcba9876543210fedcba9876543210',
                chunk_size_bytes: 10,
                chunk_count: 1,
                byte_size: 10,
            });
        }
        if (String(url).includes('/chunks/0')) {
            chunkAttempts += 1;
            return response(503, { detail: 'temporary' });
        }
        if (String(url).endsWith('fedcba9876543210fedcba9876543210')) return response(200, { aborted: true });
        throw new Error(`unexpected URL ${url}`);
    };
    const rootObject = root();
    rootObject.setTimeout = (fn) => { fn(); return 1; };
    rootObject.clearTimeout = () => {};
    const wrapped = Resumable.createResumableFetch(rootObject, {
        fetchImpl,
        thresholdBytes: 1,
    });

    await assert.rejects(
        wrapped('https://backend.test/api/v1/upload', {
            method: 'POST',
            body: formWith(fakeFile(10)),
        }),
        /Upload chunk 1\/1 failed \(HTTP 503\)/,
    );
    assert.equal(chunkAttempts, Resumable.MAX_CHUNK_ATTEMPTS);
    assert.equal(urls.at(-1), 'https://staging.example.test/api/v1/upload-sessions/fedcba9876543210fedcba9876543210');
});
