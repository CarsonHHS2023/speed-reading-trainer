const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const PROD = 'https://carsonhhs-pdf-ocr-service.hf.space';
const STAGING = 'https://carsonhhs-pdf-ocr-service-staging.hf.space';
const TEST = 'https://carsonhhs-pdf-ocr-service-ocrmypdf-test.hf.space';
const SHARED_KEY = 'smart-reading-access-token';
const STAGING_KEY = `${SHARED_KEY}:s0-staging`;
const SHA = 'a'.repeat(40);
const runtime = fs.readFileSync('preview-runtime.js', 'utf8');
const access = fs.readFileSync('app-access.js', 'utf8');

function harness({ pathname = '/speed-reading-trainer/preview/pr-86/', marker = true,
    head = SHA, values = new Map(), loginStatus = 200, protectedStatus = 200 } = {}) {
    const calls = [], scripts = [];
    const root = {
        URL, Headers, Request,
        location: { pathname, href: `https://carsonhhs2023.github.io${pathname}` },
        sessionStorage: {
            getItem: key => values.get(key) || null,
            setItem: (key, value) => values.set(key, String(value)),
            removeItem: key => values.delete(key),
        },
        document: {
            querySelector(selector) {
                if (selector === 'meta[name="atlas-s0-reader-preview"]') return marker ? { content: '1' } : null;
                if (selector === 'meta[name="reader-preview-head"]') return { content: head };
                return null;
            },
            write: html => scripts.push(html),
            addEventListener() {},
        },
        console: { info() {} },
        fetch: async (input, init = {}) => {
            const url = typeof input === 'string' ? input : input.url;
            const headers = new Headers(init.headers || input.headers);
            calls.push({ url, method: init.method || 'GET', authorization: headers.get('authorization') });
            const login = url.endsWith('/api/access/login');
            const status = login ? loginStatus : protectedStatus;
            return { ok: status === 200, status,
                json: async () => login && status === 200
                    ? { access_token: url.startsWith(STAGING) ? 'staging-signed' : 'production-signed' }
                    : { detail: 'Authentication required' } };
        },
    };
    root.window = root;
    const context = vm.createContext({ window: root, globalThis: root, URL, Headers, Request });
    vm.runInContext(runtime, context);
    vm.runInContext(access, context);
    return { root, calls, scripts, values };
}

test('actual S0 bootstrap uses Staging login and its returned token for books and Reader', async () => {
    const h = harness({ values: new Map([[SHARED_KEY, 'old-production-token']]) });
    assert.equal(h.root.AppAccess.getToken(), '');
    assert.equal(h.root.AppAccess.resolveAuthBaseUrl(), STAGING);
    assert.match(h.scripts[0], new RegExp(`app-access\\.js\\?v=${SHA}`));
    await h.root.AppAccess.login('test-only-development-password');
    assert.deepEqual(h.calls[0], { url: `${STAGING}/api/access/login`, method: 'POST', authorization: null });
    assert.equal(h.values.get(STAGING_KEY), 'staging-signed');
    assert.equal(h.values.get(SHARED_KEY), 'old-production-token');

    await h.root.fetch(`${PROD}/api/v1/books`);
    await h.root.fetch(`${STAGING}/api/reader/v2/documents/fixture`);
    await h.root.fetch(new Request(`${PROD}/api/v1/books`));
    assert.deepEqual(h.calls.slice(1).map(c => [c.url, c.authorization]), [
        [`${STAGING}/api/v1/books`, 'Bearer staging-signed'],
        [`${STAGING}/api/reader/v2/documents/fixture`, 'Bearer staging-signed'],
        [`${STAGING}/api/v1/books`, 'Bearer staging-signed'],
    ]);
    await h.root.fetch('https://example.com/public');
    assert.equal(h.calls.at(-1).authorization, null);
    assert.equal(h.calls.some(c => c.url.startsWith(PROD)), false);
});

test('Staging session survives reload and logout never clears the shared session', async () => {
    const values = new Map([[SHARED_KEY, 'shared']]);
    const first = harness({ values });
    await first.root.AppAccess.login('test-only-development-password');
    const reloaded = harness({ values });
    assert.equal(reloaded.root.AppAccess.getToken(), 'staging-signed');
    reloaded.root.AppAccess.clearToken();
    assert.equal(values.has(STAGING_KEY), false);
    assert.equal(values.get(SHARED_KEY), 'shared');
});

test('Staging 401 clears only its session, without falling back to Production', async () => {
    const h = harness({ protectedStatus: 401, values: new Map([[SHARED_KEY, 'shared'], [STAGING_KEY, 'expired-staging']]) });
    assert.equal((await h.root.fetch(`${STAGING}/api/v1/books`)).status, 401);
    assert.equal(h.root.AppAccess.getToken(), '');
    assert.equal(h.values.get(SHARED_KEY), 'shared');
    assert.equal(h.calls.length, 1);
});

for (const status of [401, 503]) test(`Staging login ${status} fails closed without shared-auth fallback`, async () => {
    const h = harness({ loginStatus: status, values: new Map([[SHARED_KEY, 'shared']]) });
    await assert.rejects(h.root.AppAccess.login('test-only-development-password'));
    assert.equal(h.values.has(STAGING_KEY), false);
    assert.equal(h.values.get(SHARED_KEY), 'shared');
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, `${STAGING}/api/access/login`);
});

for (const [pathname, marker, dataBase] of [
    ['/speed-reading-trainer/', false, PROD],
    ['/speed-reading-trainer/', true, PROD],
    ['/speed-reading-trainer/preview/pr-74/', false, TEST],
]) test(`unchanged shared auth outside S0: ${pathname}, marker=${marker}`, async () => {
    const h = harness({ pathname, marker, values: new Map([[SHARED_KEY, 'shared'], [STAGING_KEY, 'staging']]) });
    assert.equal(h.root.APP_ACCESS_AUTH_BASE_URL, undefined);
    assert.equal(h.root.APP_ACCESS_SESSION_TOKEN_KEY, undefined);
    assert.equal(h.root.AppAccess.getToken(), 'shared');
    assert.match(h.scripts[0], /src="app-access\.js"/);
    await h.root.AppAccess.login('test-only-development-password');
    assert.equal(h.calls[0].url, `${PROD}/api/access/login`);
    await h.root.fetch(`${PROD}/api/v1/books`);
    assert.equal(h.calls[1].url, `${dataBase}/api/v1/books`);
    assert.equal(h.calls[1].authorization, 'Bearer production-signed');
    h.root.AppAccess.clearToken();
    assert.equal(h.values.get(STAGING_KEY), 'staging');
});

test('malformed preview SHA cannot enter the generated auth-script URL', () => {
    const h = harness({ head: '\"><script>untrusted</script>' });
    assert.match(h.scripts[0], /src="app-access\.js"/);
    assert.equal(h.scripts[0].includes('untrusted'), false);
});
