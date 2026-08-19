const test = require('node:test');
const assert = require('node:assert/strict');

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

function payload(overrides = {}) {
    return {
        schema_version: 1,
        application_max_bytes: 100,
        supported_file_types: ['pdf', 'txt'],
        direct_upload_available: true,
        direct_upload_file_types: ['pdf'],
        direct_single_put_max_bytes: 80,
        resumable_upload_available: true,
        resumable_upload_file_types: ['pdf', 'txt'],
        resumable_transport_max_bytes: 1000,
        ...overrides,
    };
}

function file(size, overrides = {}) {
    return {
        name: 'book.pdf',
        type: 'application/pdf',
        size,
        slice() { return new Uint8Array(); },
        ...overrides,
    };
}

function root(nowRef, overrides = {}) {
    return {
        SPEED_READING_CONFIG: {
            environment: 'staging',
            apiBaseUrl: 'https://staging.example.test',
        },
        READER_API_BASE_URL: 'https://staging.example.test',
        location: { href: 'https://reader.example.test/staging/' },
        URL,
        AbortController,
        Date: { now: () => nowRef.value },
        setTimeout,
        clearTimeout,
        console: { info() {}, warn() {}, error() {} },
        ...overrides,
    };
}

test('application and transport maxima are inclusive boundaries', () => {
    const capabilities = Capabilities.validateCapabilities(payload());
    const client = Capabilities.createClient(root({ value: 0 }), {
        fetchImpl: async () => response(200, payload()),
    });

    assert.equal(client.localAdmission(file(100), capabilities).allowed, true);
    assert.equal(client.localAdmission(file(101), capabilities).status, 413);

    const directRoot = root({ value: 0 }, {
        BookshelfUploadCapabilities: { peekCapabilities: () => capabilities },
    });
    assert.equal(Direct.capabilityAllowsDirectUpload(file(80), directRoot), true);
    assert.equal(Direct.capabilityAllowsDirectUpload(file(81), directRoot), false);

    const resumableRoot = root({ value: 0 }, {
        BookshelfUploadCapabilities: { peekCapabilities: () => capabilities },
    });
    assert.equal(Resumable.capabilityAllowsResumableUpload(file(1000), resumableRoot), true);
    assert.equal(Resumable.capabilityAllowsResumableUpload(file(1001), resumableRoot), false);
});

test('expired capability cache refreshes backend policy before admitting another file', async () => {
    const nowRef = { value: 1000 };
    const responses = [
        payload({ application_max_bytes: 100 }),
        payload({ application_max_bytes: 50 }),
    ];
    let calls = 0;
    const client = Capabilities.createClient(root(nowRef), {
        cacheTtlMs: 60_000,
        fetchImpl: async () => {
            const next = responses[Math.min(calls, responses.length - 1)];
            calls += 1;
            return response(200, next);
        },
    });

    const first = await client.preflightFile(file(75));
    assert.equal(first.allowed, true);
    assert.equal(calls, 1);

    nowRef.value += 59_000;
    const cached = await client.preflightFile(file(75));
    assert.equal(cached.allowed, true);
    assert.equal(calls, 1);

    nowRef.value += 2_000;
    const refreshed = await client.preflightFile(file(75));
    assert.equal(refreshed.allowed, false);
    assert.equal(refreshed.status, 413);
    assert.equal(calls, 2);
});
