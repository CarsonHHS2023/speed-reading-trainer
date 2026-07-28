const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Study = require('../reader-study-context.js');
const Annotations = require('../reader-annotations.js');
const Highlights = require('../reader-highlights.js');

const view = {
    document_ref: 'doc-1',
    candidate_id: 'cand-1',
    contract_version: '2',
    candidate_schema_id: 'atlas.structured-content-candidate',
    candidate_schema_version: 2,
};

const nodes = [
    { node_id: 'n2', order: 2, text: 'Second paragraph with an important highlighted phrase.' },
    { node_id: 'n1', order: 1, text: 'First paragraph for a bookmark and note.' },
];

function location(nodeId) {
    return { node_id: nodeId, source_unit_id: 'flow-1', source_anchor: { kind: 'text_span', start: 0, end: 10 } };
}

function annotation(kind, nodeId, id, now, noteText = '') {
    return Annotations.recordForLocation(view, location(nodeId), {
        kind, annotationId: id, now, noteText,
    });
}

function highlight(nodeId, id, start, end, now) {
    return Highlights.recordForRange(view, location(nodeId), start, end, {
        highlightId: id, now,
    });
}

test('StudyContext orders by semantic node order then record order and preserves identity', () => {
    const result = Study.buildStudyContext(view, nodes, [
        annotation('note', 'n2', 'note-2', 10, 'later note'),
        annotation('bookmark', 'n1', 'bookmark-1', 20),
        annotation('note', 'n1', 'note-1', 30, 'first note'),
    ], [highlight('n2', 'hi-1', 24, 45, 5)]);

    assert.deepEqual(result.items.map((item) => item.item_id), ['bookmark-1', 'note-1', 'hi-1', 'note-2']);
    assert.equal(result.items[0].candidate_id, 'cand-1');
    assert.equal(result.items[0].node_id, 'n1');
    assert.deepEqual(result.items[0].source_anchor, { kind: 'text_span', start: 0, end: 10 });
});

test('highlight excerpt is resolved ephemerally from current node text', () => {
    const record = highlight('n2', 'hi-1', 24, 45, 5);
    const result = Study.buildStudyContext(view, nodes, [], [record]);
    assert.equal(result.items[0].excerpt, nodes[0].text.slice(24, 45));
    const serializedSourceRecord = JSON.stringify(record);
    assert.equal(serializedSourceRecord.includes(result.items[0].excerpt), false);
});

test('stale records are excluded and counted without remapping', () => {
    const staleView = { ...view, candidate_id: 'cand-old' };
    const staleNote = Annotations.recordForLocation(staleView, location('n1'), { kind: 'note', annotationId: 'old-note', noteText: 'old', now: 1 });
    const result = Study.buildStudyContext(view, nodes, [staleNote, annotation('bookmark', 'n1', 'b1', 2)], []);
    assert.equal(result.items.length, 1);
    assert.equal(result.stats.stale_excluded, 1);
});

test('malformed or out-of-range highlights fail closed', () => {
    const invalid = highlight('n2', 'bad', 0, 999, 1);
    const result = Study.buildStudyContext(view, nodes, [], [invalid, { nope: true }]);
    assert.deepEqual(result.items, []);
    assert.equal(result.stats.invalid_excluded, 2);
});

test('item count and excerpts are bounded deterministically', () => {
    const records = [
        annotation('bookmark', 'n1', 'b1', 1),
        annotation('note', 'n1', 'n1-note', 2, 'note'),
        annotation('bookmark', 'n2', 'b2', 3),
    ];
    const result = Study.buildStudyContext(view, nodes, records, [], { maxItems: 2, excerptLength: 12 });
    assert.equal(result.items.length, 2);
    assert.equal(result.stats.truncated, true);
    assert.ok(result.items.every((item) => item.excerpt.length <= 12));
});

test('StudyContext has no persisted store or legacy content dependency', () => {
    const source = fs.readFileSync(require.resolve('../reader-study-context.js'), 'utf8');
    for (const forbidden of ['localStorage', 'sessionStorage', 'setItem(', '/api/reader/v1', '/api/v1/books/', 'cachedContentBlob', 'state.content', 'tokenizeContent(', 'page_id', 'presentation_id', 'artifact_ref', 'storage_ref', 'signed_url']) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
});

test('StudyContext UI loads later semantic nodes through Reader v2 and does not persist projection', () => {
    const source = fs.readFileSync(require.resolve('../reader-study-context-ui.js'), 'utf8');
    assert.match(source, /ensureNodeLoaded/);
    assert.match(source, /buildStudyContext/);
    for (const forbidden of ['setItem(', '/api/reader/v1', '/api/v1/books/', 'cachedContentBlob', 'state.content', 'tokenizeContent(', 'page_id', 'presentation_id']) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
});