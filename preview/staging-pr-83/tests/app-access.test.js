const test = require('node:test');
const assert = require('node:assert/strict');

const AppAccess = require('../app-access.js');
const Assets = require('../reader-assets.js');

const PROD_BASE = 'https://carsonhhs-pdf-ocr-service.hf.space';
const TEST_BASE = 'https://carsonhhs-pdf-ocr-service-ocrmypdf-test.hf.space';

function makeStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
        values,
    };
}

function makeRoot(overrides = {}) {
    return {
        URL,
        Headers,
        location: { href: 'https://carsonhhs2023.github.io/speed-reading-trainer/' },
        sessionStorage: makeStorage(),
        ...overrides,
    };
}

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return body; },
    };
}

test('backend recognition covers production and Preview data origins only', () => {
    const root = makeRoot({
        READER_API_BASE_URL: TEST_BASE,
        API_BASE_URL_OVERRIDE: TEST_BASE,
    });

    assert.equal(AppAccess.isBackendRequest(`${PROD_BASE}/api/v1/books`, root), true);
    assert.equal(AppAccess.isBackendRequest(`${TEST_BASE}/api/v1/books`, root), true);
    assert.equal(AppAccess.isBackendRequest('https://example.com/api/v1/books', root), false);
    assert.equal(AppAccess.resolveAuthBaseUrl(root), PROD_BASE);
    assert.equal(AppAccess.resolveApiBaseUrl(root), TEST_BASE);
});

test('authenticated fetch sends Bearer token only to recognized backend origins', async () => {
    const calls = [];
    const root = makeRoot();
    const controller = AppAccess.createController(root, {
        fetchImpl: async (input, init = {}) => {
            calls.push({
                url: String(input),
                authorization: new Headers(init.headers || {}).get('authorization'),
            });
            return jsonResponse({ ok: true });
        },
    });
    controller.setToken('signed-development-token');

    await controller.authenticatedFetch(`${PROD_BASE}/api/v1/books`);
    await controller.authenticatedFetch('https://example.com/telemetry');

    assert.equal(calls[0].authorization, 'Bearer signed-development-token');
    assert.equal(calls[1].authorization, null);
});

test('Preview hard-coded production calls still receive auth before URL rewrite', async () => {
    const calls = [];
    const root = makeRoot({
        READER_API_BASE_URL: TEST_BASE,
        API_BASE_URL_OVERRIDE: TEST_BASE,
    });
    const controller = AppAccess.createController(root, {
        fetchImpl: async (input, init = {}) => {
            calls.push({ url: String(input), headers: new Headers(init.headers || {}) });
            return jsonResponse({ ok: true });
        },
    });
    controller.setToken('preview-token');

    await controller.authenticatedFetch(`${PROD_BASE}/api/v1/books`);
    await controller.authenticatedFetch(`${TEST_BASE}/api/reader/v2/documents/doc-1`);

    assert.equal(calls[0].headers.get('authorization'), 'Bearer preview-token');
    assert.equal(calls[1].headers.get('authorization'), 'Bearer preview-token');
});

test('login always uses production auth endpoint and stores only the returned token in sessionStorage', async () => {
    const calls = [];
    const root = makeRoot({
        READER_API_BASE_URL: TEST_BASE,
        API_BASE_URL_OVERRIDE: TEST_BASE,
    });
    const controller = AppAccess.createController(root, {
        fetchImpl: async (input, init = {}) => {
            calls.push({ url: String(input), init });
            return jsonResponse({
                access_token: 'issued-token',
                token_type: 'bearer',
                expires_in: 43200,
            });
        },
    });

    await controller.login('a sufficiently long password');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${PROD_BASE}/api/access/login`);
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), { password: 'a sufficiently long password' });
    assert.equal(new Headers(calls[0].init.headers).get('authorization'), null);
    assert.equal(controller.getToken(), 'issued-token');
    assert.equal(root.sessionStorage.values.size, 1);
    assert.equal(root.sessionStorage.values.get(AppAccess.SESSION_TOKEN_KEY), 'issued-token');
});

test('401 from protected backend clears the session token', async () => {
    const root = makeRoot();
    const controller = AppAccess.createController(root, {
        fetchImpl: async () => jsonResponse({ detail: 'Authentication required' }, 401),
    });
    controller.setToken('expired-token');

    const response = await controller.authenticatedFetch(`${PROD_BASE}/api/v1/books`);

    assert.equal(response.status, 401);
    assert.equal(controller.getToken(), '');
});

test('protected Reader image content is fetched through AppAccess and rendered as a Blob URL', async () => {
    const previous = globalThis.AppAccess;
    const calls = [];
    globalThis.AppAccess = {
        async fetchBlobUrl(url) {
            calls.push(url);
            return 'blob:protected-reader-asset';
        },
    };

    class FakeElement {
        constructor(tag) {
            this.tagName = tag.toUpperCase();
            this.children = [];
            this.className = '';
            this.textContent = '';
            this.src = '';
            this.alt = '';
        }
        appendChild(child) { this.children.push(child); return child; }
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            return child;
        }
        get firstChild() { return this.children[0] || null; }
    }

    const documentObject = { createElement: (tag) => new FakeElement(tag) };
    const target = new FakeElement('div');
    const resolver = {
        async resolveFirstAvailable() {
            return {
                metadata: { alt_text: 'Protected image', caption: 'Caption' },
                contentUrl: `${PROD_BASE}/api/reader/v2/documents/doc/assets/a/content`,
            };
        },
    };

    try {
        await Assets.renderAssetInto({
            documentObject,
            resolver,
            documentRef: 'doc',
            candidateId: 'cand',
            assetRefs: ['a'],
            nodeType: 'figure',
            target,
        });

        assert.deepEqual(calls, [`${PROD_BASE}/api/reader/v2/documents/doc/assets/a/content`]);
        assert.equal(target.children[0].children[0].src, 'blob:protected-reader-asset');
    } finally {
        if (previous === undefined) delete globalThis.AppAccess;
        else globalThis.AppAccess = previous;
    }
});
