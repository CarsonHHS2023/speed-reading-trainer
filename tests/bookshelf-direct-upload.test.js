const test = require('node:test');
const assert = require('node:assert/strict');

const Direct = require('../bookshelf-direct-upload.js');

function response(status, payload = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return payload; },
    };
}

function root(environment = 'staging', progressHistory = null) {
    const prompt = progressHistory
        ? {
            _html: '',
            set innerHTML(value) {
                this._html = String(value);
                progressHistory.push(this._html);
            },
            get innerHTML() { return this._html; },
        }
        : null;
    return {
        SPEED_READING_CONFIG: {
            environment,
            apiBaseUrl: 'https://staging.example.test',
        },
        READER_API_BASE_URL: 'https://staging.example.test',
        location: { href: 'https://reader.example.test/staging/' },
        URL,
        AbortController,
        setTimeout,
        clearTimeout,
        crypto: {
            subtle: {
                async digest(algorithm) {
                    assert.equal(algorithm, 'SHA-256');
                    return new Uint8Array(32).fill(0xab);
                },
            },
        },
        console: { info() {}, warn() {}, error() {} },
        document: {
            getElementById(id) {
                if (id !== 'uploadZone' || !prompt) return null;
                return {
                    querySelector(selector) {
                        return selector === '.upload-prompt' ? prompt : null;
                    },
                };
            },
        },
    };
}

function fakeFile(size = 10, overrides = {}) {
    return {
        name: 'large.pdf',
        type: 'application/pdf',
        size,
        async arrayBuffer() { return new Uint8Array([1, 2, 3, 4]).buffer; },
        ...overrides,
    };
}

function formWith(file) {
    return {
        get(name) { return name === 'file' ? file : null; },
    };
}

test('large staging PDF uses browser to object-storage direct upload and returns completion response', async () => {
    const calls = [];
    const progress = [];
    const checksum = 'ab'.repeat(32);
    const file = fakeFile(10);
    const complete = response(200, { status: 'processing', book_id: 'book-1' });
    const fetchImpl = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (calls.length === 1) {
            return response(200, {
                upload_id: '1994b55d1883451eae4da029400f4635',
                upload_mode: 'single_put',
                upload_url: 'https://s3.hf.co/carsonhhs/test-bucket/atlas/ingress/1994b55d1883451eae4da029400f4635?X-Amz-Signature=redacted',
                upload_method: 'PUT',
                upload_headers: { 'Content-Type': 'application/pdf' },
                expires_in_seconds: 900,
                byte_size: 10,
                checksum_sha256: checksum,
                completion_token: 'completion-token-redacted-value',
            });
        }
        if (String(url).startsWith('https://s3.hf.co/')) return response(200);
        if (String(url).endsWith('/complete')) return complete;
        throw new Error(`unexpected URL ${url}`);
    };
    const rootObject = root('staging', progress);
    const wrapped = Direct.createDirectUploadFetch(rootObject, {
        fetchImpl,
        thresholdBytes: 5,
    });

    const result = await wrapped('https://carsonhhs-pdf-ocr-service.hf.space/api/v1/upload', {
        method: 'POST',
        body: formWith(file),
    });

    assert.equal(result, complete);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, 'https://staging.example.test/api/v1/direct-upload-sessions');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
        filename: 'large.pdf',
        byte_size: 10,
        checksum_sha256: checksum,
        content_type: 'application/pdf',
    });
    assert.match(calls[1].url, /^https:\/\/s3\.hf\.co\//);
    assert.equal(calls[1].init.method, 'PUT');
    assert.deepEqual(calls[1].init.headers, { 'Content-Type': 'application/pdf' });
    assert.equal(calls[1].init.body, file);
    assert.equal(
        calls[2].url,
        'https://staging.example.test/api/v1/direct-upload-sessions/1994b55d1883451eae4da029400f4635/complete',
    );
    assert.deepEqual(JSON.parse(calls[2].init.body), {
        completion_token: 'completion-token-redacted-value',
    });
    assert.ok(progress.some((entry) => /计算 PDF 校验值/.test(entry)));
    assert.ok(progress.some((entry) => /HF Storage Bucket/.test(entry)));
    assert.match(progress.at(-1), /100%/);
    assert.match(progress.at(-1), /提交处理任务/);
});

test('locked 100-page S0 benchmark is above the default direct-upload threshold', () => {
    const benchmarkBytes = 12_486_675;
    assert.equal(Direct.DIRECT_UPLOAD_THRESHOLD_BYTES, 8 * 1024 * 1024);
    assert.ok(benchmarkBytes >= Direct.DIRECT_UPLOAD_THRESHOLD_BYTES);
    assert.ok(benchmarkBytes < 16 * 1024 * 1024);
});

test('small staging PDF remains on the existing upload stack', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return response(200, { status: 'processing' });
    };
    const rootObject = root();
    const wrapped = Direct.createDirectUploadFetch(rootObject, {
        fetchImpl,
        thresholdBytes: 20,
    });
    const body = formWith(fakeFile(10));

    await wrapped('https://backend.test/api/v1/upload', { method: 'POST', body });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.body, body);
});

test('large non-PDF staging file remains on the existing resumable fallback', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return response(200, {});
    };
    const wrapped = Direct.createDirectUploadFetch(root(), {
        fetchImpl,
        thresholdBytes: 5,
    });
    const body = formWith(fakeFile(10, { name: 'large.txt', type: 'text/plain' }));

    await wrapped('https://backend.test/api/v1/upload', { method: 'POST', body });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.body, body);
});

test('production never enables direct object upload', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init });
        return response(200, {});
    };
    const wrapped = Direct.createDirectUploadFetch(root('production'), {
        fetchImpl,
        thresholdBytes: 1,
    });

    await wrapped('https://backend.test/api/v1/upload', {
        method: 'POST',
        body: formWith(fakeFile(100)),
    });

    assert.equal(calls.length, 1);
});

test('direct upload surfaces backend admission errors without falling back to HF Space body upload', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url: String(url), init });
        return response(413, { detail: 'PDF exceeds the current direct single-PUT upload limit' });
    };
    const wrapped = Direct.createDirectUploadFetch(root(), {
        fetchImpl,
        thresholdBytes: 1,
    });

    await assert.rejects(
        wrapped('https://backend.test/api/v1/upload', {
            method: 'POST',
            body: formWith(fakeFile(101)),
        }),
        /Create direct upload session failed \(HTTP 413\): PDF exceeds the current direct single-PUT upload limit/,
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/v1\/direct-upload-sessions$/);
});

test('direct PUT timeout uses most of the signed URL lifetime instead of the legacy 120 second limit', () => {
    assert.equal(Direct.directPutTimeoutMs({ expires_in_seconds: 900 }), 870000);
    assert.equal(Direct.directPutTimeoutMs({ expires_in_seconds: 60 }), 120000);
});

test('direct upload emits safe phase timings and browser-observable connection timing', async () => {
    const checksum = 'ab'.repeat(32);
    const file = fakeFile(10);
    const signedUrl = 'https://s3.hf.co/carsonhhs/test-bucket/atlas/ingress/abc?X-Amz-Signature=secret-value';
    const completionToken = 'completion-token-must-not-be-logged';
    const calls = [];
    const logs = [];
    const clock = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
    let clockIndex = 0;
    const rootObject = root();
    rootObject.console.info = (...args) => logs.push(args);
    rootObject.performance = {
        now() { return clock[clockIndex++] ?? 90; },
        getEntriesByName(name, type) {
            assert.equal(name, signedUrl);
            assert.equal(type, 'resource');
            return [{
                duration: 9,
                domainLookupStart: 1,
                domainLookupEnd: 2,
                connectStart: 2,
                secureConnectionStart: 3,
                connectEnd: 4,
                requestStart: 4,
                responseStart: 7,
                responseEnd: 9,
                nextHopProtocol: 'h2',
            }];
        },
    };
    const fetchImpl = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (calls.length === 1) {
            return response(200, {
                upload_id: '1994b55d1883451eae4da029400f4635',
                upload_mode: 'single_put',
                upload_url: signedUrl,
                upload_method: 'PUT',
                upload_headers: { 'Content-Type': 'application/pdf' },
                expires_in_seconds: 900,
                byte_size: 10,
                checksum_sha256: checksum,
                completion_token: completionToken,
            });
        }
        if (String(url) === signedUrl) return response(200);
        if (String(url).endsWith('/complete')) return response(200, { status: 'processing' });
        throw new Error(`unexpected URL ${url}`);
    };

    await Direct.uploadDirectFile(file, { rootObject, fetchImpl });

    const timingLog = logs.find(([label]) => label === '[atlas upload timing]');
    assert.ok(timingLog, 'expected upload timing console record');
    const timing = timingLog[1];
    assert.deepEqual(timing, {
        upload_route: 'direct_single_put',
        file_size_bytes: 10,
        sha256_ms: 10,
        create_session_ms: 10,
        preflight_ms: null,
        preflight_observable: false,
        put_ms: 10,
        complete_ms: 10,
        total_upload_ms: 90,
        effective_MiB_per_second: 0.001,
        throughput_basis: 'put_ms',
        put_resource_timing: {
            available: true,
            duration_ms: 9,
            dns_ms: 1,
            connect_ms: 2,
            tls_ms: 1,
            request_wait_ms: 3,
            response_download_ms: 2,
            next_hop_protocol: 'h2',
        },
    });
    const serialized = JSON.stringify(timing);
    assert.doesNotMatch(serialized, /X-Amz-Signature|secret-value/);
    assert.doesNotMatch(serialized, /completion-token/);
});
