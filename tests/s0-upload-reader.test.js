const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { UploadReaderTelemetry, STAGING } = require('../s0-upload-reader.js');
const { ReaderApiClientV2 } = require('../reader-api.js');
const { ReaderV2Controller } = require('../reader-ui-v2.js');

function harness() {
    let clock = 100, serial = 0;
    const calls = [], listeners = {};
    const root = { ATLAS_S0_READER_PREVIEW: true, location: { pathname: '/preview/pr-99/' },
        addEventListener(name, fn) { listeners[name] = fn; },
        document: { visibilityState: 'visible', querySelector() { return { content: 'b'.repeat(40) }; },
            addEventListener(name, fn) { listeners[name] = fn; } },
        performance: { now: () => clock }, crypto: { getRandomValues(bytes) { bytes.fill(++serial); return bytes; } } };
    root.fetch = async (url, options = {}) => {
        calls.push({ url, ...options });
        return { ok: true, headers: new Headers({ 'X-Atlas-S0-Revision': 'a'.repeat(40) }),
            json: async () => ({ contract_version: '2', document_ref: 'doc', candidate_id: 'candidate',
                candidate_schema_id: 'atlas.structured-content.v2', candidate_schema_version: 2, nodes: [] }) };
    };
    const observer = new UploadReaderTelemetry(root);
    root.AtlasS0UploadReader = { observer };
    const api = new ReaderApiClientV2({ baseUrl: STAGING, fetchImpl: root.fetch, rootObject: root });
    const ack = op => ({ ok: true, headers: new Headers({ 'X-Atlas-S0-Upload-Accepted': op.id,
        'X-Atlas-S0-Upload-Revision': 'a'.repeat(40) }) });
    return { root, observer, api, calls, listeners, ack, advance(ms) { clock += ms; } };
}

async function core(h, upload, succeeded = true) {
    const reader = h.api.beginOpenObservation('doc', () => null, upload);
    await h.api.open('doc'); await h.api.navigation('doc', { candidateId: 'candidate' });
    await h.api.content('doc', { limit: 150, candidateId: 'candidate', startNodeOrder: 0 });
    h.advance(1250);
    h.api.finishOpenObservation(reader, { succeeded, mode: 'first_open', documentRef: 'doc', candidateId: 'candidate' });
    return reader;
}

test('same clock spans upload and processing; old Reader duration and payload stay independent', async () => {
    const h = harness(), op = h.observer.prepare(STAGING, true);
    h.observer.start(op); h.advance(120000); h.observer.acknowledge(op, h.ack(op), 'doc');
    await core(h, op);
    const posts = h.calls.filter(c => c.method === 'POST');
    assert.equal(posts.length, 2);
    const upload = JSON.parse(posts[0].body), reader = JSON.parse(posts[1].body);
    assert.equal(upload.duration_seconds, 121.25);
    assert.equal(reader.duration_seconds, 1.25);
    assert.equal(upload.open_scope_id, reader.open_scope_id);
    assert.equal(Object.keys(upload).length, 9); assert.equal(Object.keys(reader).length, 7);
    assert.equal(h.calls.filter(c => !c.method).length, 3);
    assert.doesNotMatch(posts[0].body, /filename|storage|token|https:/);
    h.observer.end(op); assert.equal(h.observer.pending, 0);
});

for (const kind of ['manual','wrong-ack','hidden','pagehide','freeze','expired','clock-replaced','failed']) {
    test(`${kind} cannot publish upload success`, async () => {
        const h = harness(), op = h.observer.prepare(STAGING, true);
        h.observer.start(op); h.observer.acknowledge(op, h.ack(op), 'doc');
        if (kind === 'manual') h.observer.selection(null, 'doc');
        if (kind === 'wrong-ack') h.observer.acknowledge(op, { ok: true, headers: new Headers() }, 'doc');
        if (kind === 'hidden') { h.root.document.visibilityState = 'hidden'; h.listeners.visibilitychange(); h.root.document.visibilityState = 'visible'; }
        if (kind === 'pagehide' || kind === 'freeze') h.listeners[kind]();
        if (kind === 'expired') h.advance(3600001);
        if (kind === 'clock-replaced') h.root.performance = { now: () => 1400 };
        await core(h, op, kind !== 'failed');
        assert.equal(h.calls.filter(c => c.url.endsWith('s0-upload-ready')).length, 0);
        h.observer.end(op);
    });
}

test('overlapping uploads and batch holds suppress all competing clocks until operations end', () => {
    const h = harness(), a = h.observer.prepare(STAGING, true), b = h.observer.prepare(STAGING, true);
    const c = h.observer.prepare(STAGING, true);
    assert.equal(a.valid, false); assert.equal(b.valid, false); assert.equal(c.valid, false);
    for (const op of [a,b,c]) h.observer.end(op);
    const batch = h.observer.prepare(STAGING, false), single = h.observer.prepare(STAGING, true);
    assert.equal(single.valid, false);
    h.observer.end(batch); h.observer.end(single);
    assert.equal(h.observer.prepare(STAGING, true).valid, true);
});

test('natural single-file method passes only its upload token to automatic selection', async () => {
    for (const processing of [false, true]) {
        const h = harness();
        const context = { ...h.root, FormData: class { append() {} }, URL,
            alert() { throw Error('business failure'); }, console: { info() {}, error() {} } };
        context.document = { ...h.root.document, querySelector(selector) {
            return { content: selector === 'meta[name="atlas-s0-reader-preview"]' ? '1' : 'b'.repeat(40) };
        } };
        context.fetch = async (url, options) => {
            assert.equal(url, `${STAGING}/api/v1/upload`);
            return { ...h.ack({ id: options.headers['X-Atlas-S0-Upload'] }),
                json: async () => ({ book_id: 'doc', status: processing ? 'processing' : 'completed' }) };
        };
        vm.createContext(context);
        vm.runInContext(fs.readFileSync('preview-runtime.js', 'utf8'), context);
        vm.runInContext(fs.readFileSync('bookshelf.js', 'utf8') + '\nglobalThis.ShelfClass = BookShelf;', context);
        const shelf = Object.create(context.ShelfClass.prototype);
        for (const name of ['setLoading','ensureCategoryIntegrity','renderCategories','renderBooks']) shelf[name] = () => {};
        shelf.books = []; shelf.normalizeBook = () => ({ id: 'doc' });
        shelf._pollBookStatus = async () => ({ status: 'completed' });
        let opened = 0;
        shelf.selectBook = async (id, op) => { assert.equal(id, 'doc'); assert.equal(op.documentRef, id); opened++; await core(h, op); };
        await shelf.handleMultiFileUpload([{ name: 'synthetic.pdf' }]);
        assert.equal(opened, 1); assert.equal(h.observer.pending, 0);
        assert.equal(h.calls.filter(c => c.url.endsWith('s0-upload-ready')).length, 1);
    }
});

test('terminal publication is detached even when its request never settles', async () => {
    const h = harness(), op = h.observer.prepare(STAGING, true);
    h.observer.start(op); h.observer.acknowledge(op, h.ack(op), 'doc');
    let count = 0;
    h.root.fetch = () => { count++; return new Promise(() => {}); };
    await core(h, op); h.observer.end(op);
    assert.equal(count, 1); assert.equal(h.observer.active, null);
    assert.equal(h.observer.diagnostics().steps.at(-1).step, 'terminal_dispatch_attempted');
});

test('diagnostics distinguish missing acknowledgement from page loss without retaining private values', async () => {
    for (const reason of ['acceptance_header_missing', 'page_hidden']) {
        const h = harness(), op = h.observer.prepare(STAGING, true);
        h.observer.start(op);
        if (reason === 'acceptance_header_missing') {
            h.observer.acknowledge(op, { ok: true, headers: new Headers() }, 'private-document');
        } else {
            h.observer.acknowledge(op, h.ack(op), 'doc');
            h.root.document.visibilityState = 'hidden'; h.listeners.visibilitychange();
            h.root.document.visibilityState = 'visible';
        }
        await core(h, op); h.observer.end(op);
        assert.equal(h.calls.filter(c => c.url.endsWith('s0-upload-ready')).length, 0);
        const diagnostic = h.observer.diagnostics();
        assert.equal(diagnostic.steps.at(-1).step, reason);
        assert.doesNotMatch(JSON.stringify(diagnostic), /private-document|upr_[0-9a-f]{32}|reader_[0-9a-f]{32}|candidate|https:|token|filename/);
        diagnostic.steps.length = 0;
        assert.ok(h.observer.diagnostics().steps.length > 0);
    }
});

test('diagnostics report HTTP status and fetch rejection without reading bodies or errors', async () => {
    for (const status of [204, 409, 503, null]) {
        const h = harness(), op = h.observer.prepare(STAGING, true);
        h.observer.start(op); h.observer.acknowledge(op, h.ack(op), 'doc');
        h.root.fetch = async () => {
            if (status === null) throw Error('private-url-and-token');
            return { status, get body() { throw Error('must not read'); } };
        };
        await core(h, op); h.observer.end(op);
        const diagnostic = h.observer.diagnostics();
        assert.deepEqual(diagnostic.steps.at(-1), {
            step: status === null ? 'terminal_fetch_rejected' : 'terminal_http_response', http_status: status,
        });
        assert.doesNotMatch(JSON.stringify(diagnostic), /private-url|token|must not read/);
    }
});

test('late terminal response cannot overwrite the next upload diagnostic', async () => {
    const h = harness(), first = h.observer.prepare(STAGING, true);
    h.observer.start(first); h.observer.acknowledge(first, h.ack(first), 'doc');
    let resolve;
    h.root.fetch = () => new Promise(done => { resolve = done; });
    await core(h, first); h.observer.end(first);
    const next = h.observer.prepare(STAGING, true);
    const before = h.observer.diagnostics();
    resolve({ status: 503 }); await Promise.resolve();
    assert.deepEqual(h.observer.diagnostics(), before);
    assert.equal(before.steps.at(-1).step, 'prepared');
    h.observer.end(next);
    assert.ok(h.observer.diagnostics().steps.length <= 16);
});

test('real core settlement excludes pending enhancement but rejects a throwing final notification', async () => {
    for (const throws of [false, true]) {
        const h = harness(), upload = h.observer.prepare(STAGING, true);
        h.observer.start(upload); h.observer.acknowledge(upload, h.ack(upload), 'doc');
        const controller = Object.create(ReaderV2Controller.prototype);
        controller.api = h.api;
        for (const name of ['reset','activateReaderSurface','setStatus','clear','renderHeader','renderNavigation','setNavigationDisabled','renderError']) controller[name] = () => {};
        controller.element = () => ({}); controller.resumeStore = { read: () => null };
        controller.requestWindow = async () => {
            await h.api.content('doc', { limit: 150, candidateId: 'candidate', startNodeOrder: 0 });
            return { nodes: [{}] };
        };
        controller.setVisibleWindows = () => { controller.nodes = [{}]; new Promise(() => {}); };
        controller.emitPageChange = () => { if (throws) throw Error('notification'); };
        if (throws) await assert.rejects(controller.openBook({ id: 'doc' }, upload), /notification/);
        else await controller.openBook({ id: 'doc' }, upload);
        assert.equal(h.calls.filter(c => c.url.endsWith('s0-upload-ready')).length, throws ? 0 : 1);
        h.observer.end(upload);
    }
});
