const test = require('node:test');
const assert = require('node:assert/strict');

const AppAccess = require('../app-access.js');

const PROD_BASE = 'https://carsonhhs-pdf-ocr-service.hf.space';
const TEST_BASE = 'https://carsonhhs-pdf-ocr-service-ocrmypdf-test.hf.space';

function storage() {
    const values = new Map();
    return {
        getItem(key) { return values.get(key) || null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
    };
}

test('Preview login uses raw production fetch while application requests keep test-backend routing', async () => {
    const authCalls = [];
    const dataCalls = [];

    const rawFetch = async (input, init = {}) => {
        authCalls.push({ url: String(input), init });
        return {
            ok: true,
            status: 200,
            async json() {
                return { access_token: 'preview-shared-token', token_type: 'bearer', expires_in: 43200 };
            },
        };
    };

    const previewFetch = async (input, init = {}) => {
        const url = String(input);
        const rewritten = url.startsWith(PROD_BASE)
            ? `${TEST_BASE}${url.slice(PROD_BASE.length)}`
            : url;
        dataCalls.push({
            url: rewritten,
            authorization: new Headers(init.headers || {}).get('authorization'),
        });
        return {
            ok: true,
            status: 200,
            async json() { return {}; },
        };
    };

    const root = {
        URL,
        Headers,
        location: { href: 'https://carsonhhs2023.github.io/speed-reading-trainer/preview/pr-73/' },
        sessionStorage: storage(),
        READER_API_BASE_URL: TEST_BASE,
        API_BASE_URL_OVERRIDE: TEST_BASE,
        __APP_ACCESS_AUTH_FETCH__: rawFetch,
    };

    const controller = AppAccess.createController(root, { fetchImpl: previewFetch });
    assert.equal(root.__APP_ACCESS_AUTH_FETCH__, undefined);

    await controller.login('a sufficiently long password');
    assert.equal(authCalls.length, 1);
    assert.equal(authCalls[0].url, `${PROD_BASE}/api/access/login`);
    assert.equal(dataCalls.length, 0);

    await controller.authenticatedFetch(`${PROD_BASE}/api/v1/books`);
    assert.equal(dataCalls.length, 1);
    assert.equal(dataCalls[0].url, `${TEST_BASE}/api/v1/books`);
    assert.equal(dataCalls[0].authorization, 'Bearer preview-shared-token');
});
