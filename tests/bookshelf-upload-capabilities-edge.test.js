const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Capabilities = require('../bookshelf-upload-capabilities.js');

function response(status, payload = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return payload; },
    };
}

class FakeResponse {
    constructor(body, init = {}) {
        this.body = String(body || '');
        this.status = Number(init.status || 200);
        this.ok = this.status >= 200 && this.status < 300;
    }

    async json() {
        return JSON.parse(this.body || '{}');
    }
}

function stagingRoot() {
    return {
        SPEED_READING_CONFIG: {
            environment: 'staging',
            apiBaseUrl: 'https://staging.example.test',
        },
        READER_API_BASE_URL: 'https://staging.example.test',
        API_BASE_URL_OVERRIDE: 'https://staging.example.test',
        location: { href: 'https://reader.example.test/staging/' },
        URL,
        AbortController,
        Response: FakeResponse,
        setTimeout,
        clearTimeout,
        console: { info() {}, warn() {}, error() {} },
    };
}

function fakeFile() {
    return { name: 'book.pdf', type: 'application/pdf', size: 10 };
}

function formWith(file) {
    return {
        get(name) { return name === 'file' ? file : null; },
    };
}

test('capability 401 stops upload instead of failing open into SHA or transport', async () => {
    const calls = [];
    const rootObject = stagingRoot();
    const fetchImpl = async (input, init = {}) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith('/api/v1/upload-capabilities')) {
            return response(401, { detail: 'Authentication required' });
        }
        throw new Error(`upload transport must not run after capability 401: ${url}`);
    };
    const guarded = Capabilities.createClient(rootObject, { fetchImpl }).createGuardedFetch();

    const result = await guarded('https://backend.example.test/api/v1/upload', {
        method: 'POST',
        body: formWith(fakeFile()),
    });

    assert.equal(result.status, 401);
    assert.deepEqual(await result.json(), { detail: 'Authentication required' });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/v1\/upload-capabilities$/);
});

function renderedBootstrap(pathname) {
    const writes = [];
    const root = {
        location: { pathname },
        fetch: async () => response(200, {}),
        console: { info() {} },
        document: {
            write(value) { writes.push(String(value)); },
        },
    };
    const source = fs.readFileSync(path.join(__dirname, '..', 'preview-runtime.js'), 'utf8');
    vm.runInNewContext(source, { window: root, globalThis: root, URL, Request });
    assert.equal(writes.length, 1);
    return writes[0];
}

test('production bootstrap does not load the staging-only capability module', () => {
    const bootstrap = renderedBootstrap('/speed-reading-trainer/');

    assert.match(bootstrap, /app-access\.js/);
    assert.match(bootstrap, /bookshelf-direct-upload\.js/);
    assert.doesNotMatch(bootstrap, /bookshelf-upload-capabilities\.js/);
});

test('staging bootstrap loads capability module after direct and before lifecycle', () => {
    const bootstrap = renderedBootstrap('/speed-reading-trainer/staging/');
    const direct = bootstrap.indexOf('bookshelf-direct-upload.js');
    const capabilities = bootstrap.indexOf('bookshelf-upload-capabilities.js');
    const lifecycle = bootstrap.indexOf('bookshelf-upload-lifecycle.js');

    assert.ok(direct >= 0);
    assert.ok(direct < capabilities);
    assert.ok(capabilities < lifecycle);
});
