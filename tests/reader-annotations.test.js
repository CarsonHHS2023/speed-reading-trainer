const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Annotations = require('../reader-annotations.js');

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

test('bookmark and note records preserve stable Reader v2 identity', () => {
    const bookmark = Annotations.recordForLocation(documentView, location, {
        kind: 'bookmark',
        now: 100,
    });
    const note = Annotations.recordForLocation(documentView, location, {
        kind: 'note',
        noteText: 'Important idea',
        annotationId: 'note-fixed',
        now: 200,
    });
    assert.equal(bookmark.annotation_id, 'bookmark:cand-1:node-7');
    assert.equal(note.annotation_id, 'note-fixed');
    assert.equal(note.note_text, 'Important idea');
    assert.deepEqual(note.source_anchor, { kind: 'text_span', start: 12, end: 30 });
    const serialized = JSON.stringify(note);
    for (const forbidden of ['presentation_page', 'scroll_offset', 'token_index', 'page_index', 'state.content', 'cachedContentBlob']) {
        assert.equal(serialized.includes(forbidden), false);
    }
});

test('store creates, updates and deletes bookmark and note records deterministically', () => {
    const store = new Annotations.ReaderAnnotationStoreV2({ storage: memoryStorage() });
    const bookmark = Annotations.recordForLocation(documentView, location, { kind: 'bookmark', now: 100 });
    const note = Annotations.recordForLocation(documentView, location, {
        kind: 'note', noteText: 'first', annotationId: 'note-1', now: 200,
    });
    store.upsert(bookmark);
    store.upsert(note);
    assert.deepEqual(store.list('doc-1').map((item) => item.annotation_id), [bookmark.annotation_id, 'note-1']);

    const edited = Annotations.recordForLocation(documentView, location, {
        kind: 'note', noteText: 'edited', annotationId: 'note-1', createdAt: note.created_at, now: 300,
    });
    store.upsert(edited);
    assert.equal(store.list('doc-1').find((item) => item.annotation_id === 'note-1').note_text, 'edited');
    assert.equal(store.remove('doc-1', 'note-1'), true);
    assert.equal(store.list('doc-1').length, 1);
    store.clear('doc-1');
    assert.deepEqual(store.list('doc-1'), []);
});

test('candidate changes mark annotations stale instead of remapping', () => {
    const record = Annotations.recordForLocation(documentView, location, { kind: 'bookmark', now: 100 });
    assert.equal(Annotations.sameCandidate(record, documentView), true);
    assert.equal(Annotations.sameCandidate(record, { ...documentView, candidate_id: 'cand-2' }), false);
});

test('malformed and old storage payloads fail closed', () => {
    const storage = memoryStorage();
    const key = Annotations.storageKey('doc-1');
    storage.setItem(key, '{bad json');
    const store = new Annotations.ReaderAnnotationStoreV2({ storage });
    assert.deepEqual(store.list('doc-1'), []);
    storage.setItem(key, JSON.stringify({ version: 999, records: [] }));
    assert.deepEqual(store.list('doc-1'), []);
});

test('annotation UI source navigates through Reader v2 loading and does not use legacy content identity', () => {
    const source = fs.readFileSync(require.resolve('../reader-annotations-ui.js'), 'utf8');
    assert.match(source, /ensureNodeLoaded/);
    assert.match(source, /navigateTo/);
    assert.match(source, /sameCandidate/);
    for (const forbidden of ['/api/reader/v1', '/api/v1/books/', 'cachedContentBlob', 'state.content', 'tokenizeContent(', 'imageMarkerMap', 'page_id', 'presentation_id']) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
});

test('annotation store source persists only Reader-safe identity plus user note text', () => {
    const source = fs.readFileSync(require.resolve('../reader-annotations.js'), 'utf8');
    for (const forbidden of ['artifact_ref', 'storage_ref', 'signed_url', 'provider_json', 'canonical_text', 'cachedContentBlob', 'state.content', 'page_id', 'presentation_id']) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
});