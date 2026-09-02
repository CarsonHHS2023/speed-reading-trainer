const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { ReaderOpenTelemetry, STAGING } = require('../s0-reader-open.js');
const { ReaderApiClientV2 } = require('../reader-api.js');
const { ReaderV2Controller } = require('../reader-ui-v2.js');

function harness() {
    let clock = 100, serial = 0;
    const calls = [];
    const root = { ATLAS_S0_READER_PREVIEW: true, location: { pathname: '/preview/pr-75/' },
        document: { querySelector() { return { content: 'b'.repeat(40) }; } },
        performance: { now: () => clock }, crypto: { getRandomValues(bytes) { bytes.fill(++serial); return bytes; } } };
    const fetchImpl = async (url, options = {}) => {
        calls.push({ url, ...options });
        return { ok: true, status: 200, headers: new Headers({ 'X-Atlas-S0-Revision': 'a'.repeat(40) }),
            json: async () => ({ contract_version: '2', document_ref: 'doc', candidate_id: 'candidate',
                candidate_schema_id: 'atlas.structured-content.v2', candidate_schema_version: 2, nodes: [] }) };
    };
    return { root, calls, fetchImpl, advance: (ms) => { clock += ms; } };
}

async function openRequests(api, reopen = false) {
    await api.open('doc');
    await api.navigation('doc', { candidateId: 'candidate' });
    await api.content('doc', { limit: 150, candidateId: 'candidate', startNodeOrder: reopen ? 150 : 0 });
    if (reopen) await api.content('doc', { limit: 150, candidateId: 'candidate', startNodeOrder: 300 });
}

for (const reopen of [false, true]) test(`correlates ${reopen ? 'reopen pair' : 'first window'} without fetching additional content`, async () => {
    const h = harness();
    const api = new ReaderApiClientV2({ baseUrl: STAGING, fetchImpl: h.fetchImpl, rootObject: h.root });
    const op = api.beginOpenObservation('doc', () => reopen ? { node_order: 180 } : null);
    await openRequests(api, reopen);
    await api.asset('doc', 'asset', { candidateId: 'candidate' });
    h.advance(1250);
    api.finishOpenObservation(op, { succeeded: true, mode: reopen ? 'reopen' : 'first_open', documentRef: 'doc', candidateId: 'candidate' });
    const get = h.calls.filter(x => !x.method);
    assert.equal(get.length, reopen ? 5 : 4);
    assert.equal(get.at(-1).headers['X-Atlas-S0-Open'], undefined);
    assert.deepEqual(get.slice(0, -1).map(x => x.headers['X-Atlas-S0-Ordinal']), reopen ? ['1','2','3','4'] : ['1','2','3']);
    const post = h.calls.find(x => x.method === 'POST');
    const body = JSON.parse(post.body);
    assert.equal(body.duration_seconds, 1.25);
    assert.equal(body.request_count, reopen ? 4 : 3);
    assert.deepEqual(Object.keys(body).sort(), ['open_scope_id','candidate_id','frontend_revision','backend_revision','mode','request_count','duration_seconds'].sort());
    assert.doesNotMatch(post.body, /filename|node_id|node_order|storage|https:/);
    api.finishOpenObservation(op, { succeeded: true });
    assert.equal(h.calls.filter(x => x.method === 'POST').length, 1);
});

test('Production, ordinary Preview, wrong backend and legacy resume are inert', () => {
    for (const mutate of [h => h.root.ATLAS_S0_READER_PREVIEW = false, h => h.root.location.pathname = '/',
        h => h.root.document.querySelector = () => null, h => h.baseUrl = 'https://production.invalid']) {
        const h = harness(); mutate(h);
        const telemetry = new ReaderOpenTelemetry({ baseUrl: h.baseUrl || STAGING, fetchImpl: h.fetchImpl, rootObject: h.root });
        assert.equal(telemetry.begin('doc', () => null), null);
        assert.equal(telemetry.request('/api/reader/v2/documents/doc'), null);
        assert.equal(h.calls.length, 0);
    }
    const h = harness();
    const t = new ReaderOpenTelemetry({ baseUrl: STAGING, fetchImpl: h.fetchImpl, rootObject: h.root });
    assert.equal(t.begin('doc', () => ({ node_id: 'legacy-private' })), null);
});

test('overlapping opens, missing runtime header, selection changes and unsupported scans cannot produce success', async () => {
    for (const kind of ['overlap','header','candidate','scan','failed']) {
        const h = harness();
        let n = 0;
        const fetchImpl = async (...args) => {
            const response = await h.fetchImpl(...args);
            if (kind === 'header') response.headers = new Headers();
            if (kind === 'candidate' && ++n === 2) response.json = async () => ({ candidate_id: 'other', document_ref: 'doc', contract_version: '2', candidate_schema_id: 'x', candidate_schema_version: 2 });
            return response;
        };
        const api = new ReaderApiClientV2({ baseUrl: STAGING, fetchImpl, rootObject: h.root });
        const op = api.beginOpenObservation('doc', () => null);
        if (kind === 'overlap') assert.equal(api.beginOpenObservation('other', () => null), null);
        try { await openRequests(api); } catch (_) {}
        if (kind === 'scan') { await api.content('doc', { limit: 150 }); await api.content('doc', { limit: 150 }); }
        api.finishOpenObservation(op, { succeeded: kind !== 'failed', mode: 'first_open', candidateId: 'candidate', documentRef: 'doc' });
        assert.equal(h.calls.filter(x => x.method === 'POST').length, 0, kind);
    }
});

test('failed telemetry POST is detached and never retries', async () => {
    const h = harness();
    const api = new ReaderApiClientV2({ baseUrl: STAGING, rootObject: h.root, fetchImpl: async (url, options) => {
        if (options?.method === 'POST') { h.calls.push({ method: 'POST' }); throw Error('offline'); }
        return h.fetchImpl(url, options);
    } });
    const op = api.beginOpenObservation('doc', () => null); await openRequests(api);
    api.finishOpenObservation(op, { succeeded: true, mode: 'first_open', documentRef: 'doc', candidateId: 'candidate' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.filter(x => x.method === 'POST').length, 1);
});

test('real controller finishes observation after semantic rendering and final page notification', async () => {
    const h = harness(), order = [];
    const controller = Object.create(ReaderV2Controller.prototype);
    controller.api = { beginOpenObservation() { order.push('begin'); return {}; },
        async open() { return { candidate_id: 'candidate' }; }, async navigation() { return { navigation: [] }; },
        finishOpenObservation(op, result) { order.push('finish'); assert.equal(result.succeeded, true); assert.equal(result.mode, 'first_open'); } };
    for (const name of ['reset','activateReaderSurface','setStatus','clear','renderHeader','renderNavigation','setNavigationDisabled']) controller[name] = () => {};
    controller.element = () => ({});
    controller.resumeStore = { read: () => null };
    controller.requestWindow = async () => ({ nodes: [{}] });
    controller.setVisibleWindows = () => { controller.nodes = [{}]; order.push('render'); };
    controller.emitPageChange = () => order.push('notify');
    await controller.openBook({ id: 'doc' });
    assert.deepEqual(order, ['begin','render','notify','finish']);
});

test('Staging routing requires an explicit build marker AND PR Preview pathname', () => {
    const source = fs.readFileSync('preview-runtime.js', 'utf8');
    for (const [path, marker, expected] of [['/preview/pr-75/', true, STAGING], ['/preview/pr-75/', false, 'https://carsonhhs-pdf-ocr-service-ocrmypdf-test.hf.space'], ['/', true, undefined]]) {
        const root = { location: { pathname: path }, document: { querySelector: () => marker ? { content: '1' } : null },
            fetch: async () => ({}), console: { info() {} }, URL };
        vm.runInNewContext(source, { globalThis: root, URL });
        assert.equal(root.READER_API_BASE_URL, expected);
        assert.equal(root.ATLAS_S0_READER_PREVIEW === true, expected === STAGING);
    }
});
