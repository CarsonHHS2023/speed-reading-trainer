const test = require('node:test');
const assert = require('node:assert/strict');
const Adapter = require('../speed-reading-adapter.js');

const documentView = {
    contract_version: '2',
    document_ref: 'doc-1',
    candidate_id: 'cand-1',
    candidate_schema_id: 'atlas.structured-content-v2',
    candidate_schema_version: 2,
};

function node(id, order, type, text, sourceUnit = 'su-1') {
    return {
        node_id: id,
        order,
        node_type: type,
        text,
        source_unit_ids: [sourceUnit],
        location: {
            node_id: id,
            source_unit_id: sourceUnit,
            source_anchor: { kind: 'text_span', start: order * 10, end: order * 10 + String(text || '').length },
        },
    };
}

test('counts CJK as one unit and complete English word as three units', () => {
    assert.equal(Adapter.countReadingUnits('中文'), 2);
    assert.equal(Adapter.countReadingUnits('hello'), 3);
    assert.equal(Adapter.countReadingUnits('中 hello 文 world'), 8);
});

test('English words are never split across bounded lines', () => {
    const tokens = Adapter.tokenizeReadingText('中 extraordinary 文');
    const lines = Adapter.tokensToLines(tokens, 5);
    const texts = lines.map((line) => line.tokens.map((token) => token.text).join(''));
    assert.ok(texts.some((text) => text.includes('extraordinary')));
    assert.equal(texts.filter((text) => text.includes('extraordinary')).length, 1);
});

test('duration formula honors speed and 12fps floor', () => {
    assert.equal(Adapter.durationMs(10, 600), 1000);
    assert.equal(Adapter.durationMs(0, 600), 1000 / 12);
    assert.equal(Adapter.durationMs(1, 60000), 1000 / 12);
});

test('manual semantic nodes become standalone non-auto-advance frames', () => {
    const result = Adapter.buildPlaybackFrames(documentView, [
        node('fig', 0, 'figure', 'Figure 1'),
        node('tbl', 1, 'table', 'Table 1'),
        node('formula', 2, 'formula', 'E=mc2'),
    ], { displayScope: 'block', speedPerMinute: 5000 });
    assert.deepEqual(result.frames.map((frame) => frame.kind), ['manual', 'manual', 'manual']);
    assert.ok(result.frames.every((frame) => frame.auto_advance === false));
    assert.ok(result.frames.every((frame) => frame.duration_ms === null));
});

test('block, line and page scopes are deterministic and preserve node identity', () => {
    const nodes = [
        node('p1', 0, 'paragraph', 'alpha beta gamma delta epsilon 中文内容'),
        node('p2', 1, 'paragraph', 'second paragraph'),
    ];
    for (const displayScope of ['block', 'line', 'page']) {
        const options = { displayScope, lineWidth: 8, maxLines: 2, speedPerMinute: 600 };
        const first = Adapter.buildPlaybackFrames(documentView, nodes, options);
        const second = Adapter.buildPlaybackFrames(documentView, [...nodes].reverse(), options);
        assert.equal(JSON.stringify(first), JSON.stringify(second));
        assert.ok(first.frames.every((frame) => frame.identity.candidate_id === 'cand-1'));
        assert.ok(first.frames.every((frame) => ['p1', 'p2'].includes(frame.identity.node_id)));
        assert.ok(first.frames.every((frame) => frame.identity.source_unit_id === 'su-1'));
        assert.ok(first.frames.every((frame) => !frame.frame_id.includes('page')));
    }
});

test('page scope packs bounded complete lines and does not split English words', () => {
    const result = Adapter.buildPlaybackFrames(documentView, [
        node('p1', 0, 'paragraph', 'one extraordinary two three four five'),
    ], { displayScope: 'page', lineWidth: 6, maxLines: 2, speedPerMinute: 600 });
    const joined = result.frames.map((frame) => frame.text).join('\n');
    assert.match(joined, /extraordinary/);
    assert.equal((joined.match(/extraordinary/g) || []).length, 1);
});

test('reading elements and frames preserve typed source location identity', () => {
    const input = node('p1', 0, 'paragraph', 'hello 世界', 'text-flow-1');
    input.location.source_anchor = { kind: 'text_span', start: 12, end: 20 };
    const result = Adapter.buildPlaybackFrames(documentView, [input], { displayScope: 'block', speedPerMinute: 600 });
    assert.deepEqual(result.elements[0].identity.source_anchor, { kind: 'text_span', start: 12, end: 20 });
    assert.deepEqual(result.frames[0].identity.source_anchor, { kind: 'text_span', start: 12, end: 20 });
});

test('adapter source has no legacy blob/tokenizer/image marker dependencies', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(require.resolve('../speed-reading-adapter.js'), 'utf8');
    for (const forbidden of ['state.content', 'cachedContentBlob', 'tokenizeContent(', 'CONTENT_DELIMITER', '/api/v1/books/', 'imageMarkerMap']) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
});