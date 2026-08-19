const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AppAccess = require('../app-access.js');
const Capabilities = require('../bookshelf-upload-capabilities.js');
const Direct = require('../bookshelf-direct-upload.js');
const Resumable = require('../bookshelf-resumable-upload.js');

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
        this.headers = init.headers || {};
    }

    async json() {
        return JSON.parse(this.body || '{}');
    }
}

function storage() {
    const values = new Map();
    return {
        getItem(key) { return values.get(key) || null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
    };
}

function root(overrides = {}) {
    return {
        SPEED_READING_CONFIG: {
            environment: 'staging',
            apiBaseUrl: 'https://staging.example.test',
        },
        READER_API_BASE_URL: 'https://staging.example.test',
        API_BASE_URL_OVERRIDE: 'https://staging.example.test',
        location: { href: 'https://reader.example.test/staging/' },
        sessionStorage: storage(),
        URL,
        Headers,
        AbortController,
        Response: FakeResponse,
        setTimeout,
        clearTimeout,
        console: { info() {}, warn() {}, error() {} },
        ...overrides,
    };
}

function capabilityPayload(overrides = {}) {
    return {
        schema_version: 1,
        application_max_bytes: 100,
        supported_file_types: ['pdf', 'txt'],
        direct_upload_available: true,
        direct_upload_file_types: ['pdf'],
        direct_single_put_max_bytes: 100,
        resumable_upload_available: true,
        resumable_upload_file_types: ['pdf', 'txt'],
        resumable_transport_max_bytes: 1000,
        ...overrides,
    };
}

function fakeFile(size = 10, overrides = {}) {
    return {
        name: 'book.pdf',
        type: 'application/pdf',
        size,
        async arrayBuffer() { return new Uint8Array([1, 2, 3]).buffer; },
        slice(start, end) { return new Uint8Array(Math.max(0, end - start)); },
        ...overrides,
    };
}

function formWith(file) {
    return {
        get(name) { return name === 'file' ? file : null; },
    };
}

test('capability schema validation is fail-closed for malformed contracts', () => {
    const valid = Capabilities.validateCapabilities(capabilityPayload());
    assert.equal(valid.application_max_bytes, 100);
    assert.equal(valid.direct_single_put_max_bytes, 100);
    assert.equal(valid.resumable_transport_max_bytes, 1000);
    assert.ok(Object.isFrozen(valid));

    assert.equal(Capabilities.validateCapabilities({}), null);
    assert.equal(Capabilities.validateCapabilities(capabilityPayload({ schema_version: 2 })), null);
    assert.equal(Capabilities.validateCapabilities(capabilityPayload({ application_max_bytes: 0 })), null);
    assert.equal(Capabilities.validateCapabilities(capabilityPayload({ direct_upload_available: 'yes' })), null);
    assert.equal(Capabilities.validateCapabilities(capabilityPayload({
        direct_upload_available: true,
        direct_single_put_max_bytes: 0,
    })), null);
});

test('application oversize is rejected before any upload transport sees the file', async () => {
    const calls = [];
    const rootObject = root();
    const fetchImpl = async (input, init = {}) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith('/api/v1/upload-capabilities')) {
            return response(200, capabilityPayload({ application_max_bytes: 100 }));
        }
        throw new Error(`upload transport must not be reached: ${url}`);
    };
    const client = Capabilities.createClient(rootObject, { fetchImpl });
    const guarded = client.createGuardedFetch();

    const result = await guarded('https://backend.example.test/api/v1/upload', {
        method: 'POST',
        body: formWith(fakeFile(101)),
    });

    assert.equal(result.status, 413);
    assert.deepEqual(await result.json(), {
        detail: 'Book source exceeds the current application upload limit of 100 bytes',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://staging.example.test/api/v1/upload-capabilities');
});

test('capability failure fails open to the existing upload stack', async () => {
    const calls = [];
    const rootObject = root();
    const fetchImpl = async (input, init = {}) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith('/api/v1/upload-capabilities')) return response(503, { detail: 'temporary' });
        return response(200, { status: 'processing' });
    };
    const guarded = Capabilities.createClient(rootObject, { fetchImpl }).createGuardedFetch();

    const result = await guarded('https://backend.example.test/api/v1/upload', {
        method: 'POST',
        body: formWith(fakeFile(10)),
    });

    assert.equal(result.status, 200);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/api\/v1\/upload-capabilities$/);
    assert.match(calls[1].url, /\/api\/v1\/upload$/);
});

test('concurrent upload preflights share one in-flight capability request', async () => {
    let capabilityCalls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const rootObject = root();
    const fetchImpl = async (input) => {
        assert.match(String(input), /\/api\/v1\/upload-capabilities$/);
        capabilityCalls += 1;
        await gate;
        return response(200, capabilityPayload());
    };
    const client = Capabilities.createClient(rootObject, { fetchImpl });
    const first = client.preflightFile(fakeFile(10));
    const second = client.preflightFile(fakeFile(20));
    await Promise.resolve();
    assert.equal(capabilityCalls, 1);
    release();

    const results = await Promise.all([first, second]);
    assert.ok(results.every((item) => item.allowed));
    assert.equal(capabilityCalls, 1);
});

test('capability GET uses the existing AppAccess authenticated fetch', async () => {
    const calls = [];
    const rootObject = root();
    const nativeFetch = async (input, init = {}) => {
        calls.push({
            url: String(input),
            authorization: new Headers(init.headers || {}).get('authorization'),
        });
        return response(200, capabilityPayload());
    };
    const access = AppAccess.createController(rootObject, {
        fetchImpl: nativeFetch,
        authFetchImpl: nativeFetch,
    });
    access.setToken('staging-shared-token');
    const client = Capabilities.createClient(rootObject, {
        fetchImpl: access.authenticatedFetch,
    });

    const capabilities = await client.requestCapabilities();

    assert.equal(capabilities.application_max_bytes, 100);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://staging.example.test/api/v1/upload-capabilities');
    assert.equal(calls[0].authorization, 'Bearer staging-shared-token');
});

test('direct route skips before SHA when backend capabilities disable direct upload', async () => {
    const calls = [];
    const rootObject = root({
        BookshelfUploadCapabilities: {
            peekCapabilities() {
                return Capabilities.validateCapabilities(capabilityPayload({
                    direct_upload_available: false,
                }));
            },
        },
        crypto: {
            subtle: {
                async digest() {
                    throw new Error('SHA must not run when direct transport is disabled');
                },
            },
        },
    });
    const fetchImpl = async (input, init) => {
        calls.push({ input: String(input), init });
        return response(200, { status: 'processing' });
    };
    const wrapped = Direct.createDirectUploadFetch(rootObject, {
        fetchImpl,
        thresholdBytes: 1,
    });

    const result = await wrapped('https://backend.example.test/api/v1/upload', {
        method: 'POST',
        body: formWith(fakeFile(10)),
    });

    assert.equal(result.status, 200);
    assert.equal(calls.length, 1);
    assert.match(calls[0].input, /\/api\/v1\/upload$/);
});

test('direct route skips before SHA when file exceeds backend direct transport maximum', async () => {
    const rootObject = root({
        BookshelfUploadCapabilities: {
            peekCapabilities() {
                return Capabilities.validateCapabilities(capabilityPayload({
                    application_max_bytes: 100,
                    direct_single_put_max_bytes: 5,
                }));
            },
        },
        crypto: {
            subtle: {
                async digest() {
                    throw new Error('SHA must not run above direct transport maximum');
                },
            },
        },
    });
    let legacyCalls = 0;
    const wrapped = Direct.createDirectUploadFetch(rootObject, {
        fetchImpl: async () => {
            legacyCalls += 1;
            return response(200, {});
        },
        thresholdBytes: 1,
    });

    await wrapped('https://backend.example.test/api/v1/upload', {
        method: 'POST',
        body: formWith(fakeFile(10)),
    });

    assert.equal(legacyCalls, 1);
});

test('resumable route respects backend transport availability before session creation', async () => {
    const rootObject = root({
        BookshelfUploadCapabilities: {
            peekCapabilities() {
                return Capabilities.validateCapabilities(capabilityPayload({
                    resumable_upload_available: false,
                }));
            },
        },
    });
    const calls = [];
    const wrapped = Resumable.createResumableFetch(rootObject, {
        fetchImpl: async (input, init) => {
            calls.push({ input: String(input), init });
            return response(200, {});
        },
        thresholdBytes: 1,
    });

    await wrapped('https://backend.example.test/api/v1/upload', {
        method: 'POST',
        body: formWith(fakeFile(10, { name: 'book.txt', type: 'text/plain' })),
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0].input, /\/api\/v1\/upload$/);
});

test('preview runtime installs capability guard outside direct and resumable transports', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'preview-runtime.js'), 'utf8');
    const access = source.indexOf('app-access.js');
    const resumable = source.indexOf('bookshelf-resumable-upload.js');
    const direct = source.indexOf('bookshelf-direct-upload.js');
    const capabilities = source.indexOf('bookshelf-upload-capabilities.js');
    const lifecycle = source.indexOf('bookshelf-upload-lifecycle.js');

    assert.ok(access >= 0);
    assert.ok(access < resumable);
    assert.ok(resumable < direct);
    assert.ok(direct < capabilities);
    assert.ok(capabilities < lifecycle);
});
