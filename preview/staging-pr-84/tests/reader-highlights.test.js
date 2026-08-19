const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Highlights = require('../reader-highlights.js');

function memoryStorage() {
    const map = new Map();
    return {
        getItem: (key) => map.has(key) ? map.get(key) : null,
        setItem: (key, value) => map.set(key, String(value)),
        removeItem: (key) => map.delete(key),
    };
}

const documentView = {
    document_ref: 'doc-1',
    candidate_id: 'cand-1',
    contract_version: '2',
    candidate_schema_id: 'atlas.structured-content-candidate',
    candidate_schema_version: 2,
};

const location = {
    node_id: 'node-7',
    source_unit_id: 'text-flow-1',
    source_anchor: { kind: 'text_span', start: 12, end: 30 },
};

test('highlight records preserve stable Reader v2 semantic range identity without document text', () => {
    const record = Highlights.recordForRange(documentView, location, 4, 18, {
        highlightId: 'highlight-fixed',
        style: 'green',
        now: 100,
    });
    assert.equal(record.highlight_id, 'highlight-fixed');
    assert.equal(record.node_id, 'node-7');
    assert.equal(record.text_start, 4);
    assert.equal(record.text_end, 18);
    assert.equal(record.style, 'green');
    assert.deepEqual(record.source_anchor, { kind: 'text_span', start: 12, end: 30 });
    const serialized = JSON.stringify(record);
    for (const forbidden of ['presentation_page', 'scroll_offset', 'token_index', 'page_index', 'canonical_text', 'highlighted_text', 'state.content', 'cachedContentBlob']) {
        assert.equal(serialized.includes(forbidden), false, forbidden);
    }
});

test('malformed and out-of-range highlight records fail closed', () => {
    assert.equal(Highlights.normalizeRecord({ version: 1 }), null);
    assert.equal(Highlights.recordForRange(documentView, location, -1, 4), null);
    assert.equal(Highlights.recordForRange(documentView, location, 4, 4), null);
    const record = Highlights.recordForRange(documentView, location, 4, 18, { highlightId: 'range', now: 1 });
    assert.equal(Highlights.validForText(record, 18), true);
    assert.equal(Highlights.validForText(record, 17), false);
});

test('highlight store creates and deletes records deterministically', () => {
    const store = new Highlights.ReaderHighlightStoreV2({ storage: memoryStorage() });
    const first = Highlights.recordForRange(documentView, location, 1, 5, { highlightId: 'h-1', now: 100 });
    const second = Highlights.recordForRange(documentView, location, 8, 12, { highlightId: 'h-2', style: 'blue', now: 200 });
    store.upsert(first);
    store.upsert(second);
    assert.deepEqual(store.list('doc-1').map((item) => item.highlight_id), ['h-1', 'h-2']);
    assert.equal(store.remove('doc-1', 'h-1'), true);
    assert.deepEqual(store.list('doc-1').map((item) => item.highlight_id), ['h-2']);
    store.clear('doc-1');
    assert.deepEqual(store.list('doc-1'), []);
});

test('candidate changes make highlights stale instead of remapping them', () => {
    const record = Highlights.recordForRange(documentView, location, 1, 5, { highlightId: 'h-1', now: 100 });
    assert.equal(Highlights.sameCandidate(record, documentView), true);
    assert.equal(Highlights.sameCandidate(record, { ...documentView, candidate_id: 'cand-2' }), false);
});

test('overlapping highlight ranges resolve into deterministic non-overlapping render segments', () => {
    const olderWide = Highlights.recordForRange(documentView, location, 0, 10, { highlightId: 'wide', style: 'yellow', now: 100 });
    const nested = Highlights.recordForRange(documentView, location, 3, 7, { highlightId: 'nested', style: 'blue', now: 200 });
    const later = Highlights.recordForRange(documentView, location, 8, 12, { highlightId: 'later', style: 'green', now: 300 });
    const segments = Highlights.segmentsForRanges(14, [later, nested, olderWide]);
    assert.deepEqual(segments, [
        { start: 0, end: 3, highlight_id: 'wide', style: 'yellow' },
        { start: 3, end: 7, highlight_id: 'wide', style: 'yellow' },
        { start: 7, end: 8, highlight_id: 'wide', style: 'yellow' },
        { start: 8, end: 10, highlight_id: 'wide', style: 'yellow' },
        { start: 10, end: 12, highlight_id: 'later', style: 'green' },
        { start: 12, end: 14, highlight_id: null, style: null },
    ]);
});

test('malformed and old storage payloads fail closed', () => {
    const storage = memoryStorage();
    const key = Highlights.storageKey('doc-1');
    storage.setItem(key, '{bad json');
    const store = new Highlights.ReaderHighlightStoreV2({ storage });
    assert.deepEqual(store.list('doc-1'), []);
    storage.setItem(key, JSON.stringify({ version: 999, records: [] }));
    assert.deepEqual(store.list('doc-1'), []);
});

test('highlight UI uses semantic selection, later-chunk loading, and no legacy identity', () => {
    const source = fs.readFileSync(require.resolve('../reader-highlights-ui.js'), 'utf8');
    assert.match(source, /ensureNodeLoaded/);
    assert.match(source, /navigateTo/);
    assert.match(source, /sameCandidate/);
    assert.match(source, /text_start/);
    assert.match(source, /text_end/);
    assert.match(source, /getSelection/);
    for (const forbidden of ['/api/reader/v1', '/api/v1/books/', 'cachedContentBlob', 'state.content', 'tokenizeContent(', 'imageMarkerMap', 'page_id', 'presentation_id']) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
});

test('highlight source persists no canonical document text or provider/storage locators', () => {
    const source = fs.readFileSync(require.resolve('../reader-highlights.js'), 'utf8');
    for (const forbidden of ['artifact_ref', 'storage_ref', 'signed_url', 'provider_json', 'canonical_text', 'highlighted_text', 'cachedContentBlob', 'state.content', 'page_id', 'presentation_id']) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
});

test('book lifecycle clears local highlights after successful deletion', () => {
    const source = fs.readFileSync(require.resolve('../reader-resume-lifecycle.js'), 'utf8');
    assert.match(source, /ReaderHighlightsUIV2/);
    assert.match(source, /clearDocument/);
});

test('index loads highlight store before UI and exposes semantic highlight controls', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const storeIndex = html.indexOf('reader-highlights.js');
    const readerIndex = html.indexOf('reader-ui-v2.js');
    const uiIndex = html.indexOf('reader-highlights-ui.js');
    const lifecycleIndex = html.indexOf('reader-resume-lifecycle.js');
    assert.ok(storeIndex >= 0 && storeIndex < readerIndex);
    assert.ok(uiIndex > readerIndex && uiIndex < lifecycleIndex);
    assert.match(html, /readerV2HighlightCreate/);
    assert.match(html, /readerV2HighlightsList/);
});