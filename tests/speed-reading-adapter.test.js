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

function lineTexts(text, width) {
    return Adapter.tokensToLines(Adapter.tokenizeReadingText(text), width)
        .map((line) => line.tokens.map((token) => token.text).join(''));
}

test('counts CJK as one unit and Latin lexical tokens as three units', () => {
    assert.equal(Adapter.countReadingUnits('中文'), 2);
    assert.equal(Adapter.countReadingUnits('hello'), 3);
    assert.equal(Adapter.countReadingUnits('中 hello 文 world'), 8);
    assert.equal(Adapter.countReadingUnits("don't state-of-the-art"), 6);
    assert.equal(Adapter.countReadingUnits('12.5% 2026-07-27'), 6);
});

test('tokenizes representative Chinese, English, and mixed-language text deterministically', () => {
    const samples = [
        '这是中文。下一句！',
        "Don't split state-of-the-art words.",
        '中文English混排AI模型2026年。',
        '价格 12.5%，时间 14:30，日期 2026-07-27。',
        'Email test@example.com or visit https://example.com/path.',
        'U.S.A. CPU 3.5GHz',
    ];
    for (const sample of samples) {
        assert.deepEqual(Adapter.tokenizeReadingText(sample), Adapter.tokenizeReadingText(sample));
        assert.ok(Adapter.tokenizeReadingText(sample).length > 0);
    }
});

test('English-like lexical tokens are never split across bounded lines', () => {
    for (const sample of ['中 extraordinary 文', '前 state-of-the-art 后', 'a test@example.com b', 'x https://example.com/very/long/path y']) {
        const tokens = Adapter.tokenizeReadingText(sample);
        const lexical = tokens.filter((token) => ['latin_lexical', 'number'].includes(token.kind));
        const lines = Adapter.tokensToLines(tokens, 5);
        for (const token of lexical) {
            const matches = lines.filter((line) => line.tokens.some((candidate) => candidate === token));
            assert.equal(matches.length, 1, token.text);
        }
    }
});

test('long English token wider than configured line remains whole on one line', () => {
    const texts = lineTexts('one extraordinary two', 5);
    assert.ok(texts.includes('extraordinary'));
    assert.equal(texts.filter((text) => text.includes('extraordinary')).length, 1);
});

test('spaces between adjacent Latin tokens are preserved while wrapped leading spaces are removed', () => {
    assert.deepEqual(lineTexts('alpha beta', 20), ['alpha beta']);
    const wrapped = lineTexts('alpha beta gamma', 6);
    assert.deepEqual(wrapped, ['alpha', 'beta', 'gamma']);
    assert.ok(wrapped.every((line) => !line.startsWith(' ') && !line.endsWith(' ')));
});

test('explicit newlines force deterministic line boundaries without empty timed lines', () => {
    assert.deepEqual(lineTexts('alpha\n\nbeta\r\n中文', 40), ['alpha', 'beta', '中文']);
});

test('avoidable closing punctuation stays attached to preceding line', () => {
    const cjk = lineTexts('你好，世界。', 2);
    assert.equal(cjk[0], '你好，');
    assert.equal(cjk.some((line) => line.startsWith('，') || line.startsWith('。')), false);

    const latin = lineTexts('hello, world!', 5);
    assert.equal(latin[0], 'hello,');
    assert.equal(latin.some((line) => line.startsWith(',') || line.startsWith('!')), false);
});

test('duration formula honors speed and 12fps floor', () => {
    assert.equal(Adapter.durationMs(10, 600), 1000);
    assert.equal(Adapter.durationMs(0, 600), 1000 / 12);
    assert.equal(Adapter.durationMs(1, 60000), 1000 / 12);
});

test('zero-unit punctuation frame uses a safe deterministic hold instead of flashing at 12fps floor', () => {
    const result = Adapter.buildPlaybackFrames(documentView, [node('punct', 0, 'paragraph', '...')], {
        displayScope: 'line', lineWidth: 10, speedPerMinute: 5000,
    });
    assert.equal(result.frames.length, 1);
    assert.equal(result.frames[0].reading_units, 0);
    assert.equal(result.frames[0].duration_ms, Adapter.ZERO_UNIT_FRAME_DURATION_MS);
    assert.ok(result.frames[0].duration_ms > Adapter.MIN_FRAME_DURATION_MS);
});

test('whitespace-only semantic text does not emit timed frames', () => {
    const result = Adapter.buildPlaybackFrames(documentView, [node('blank', 0, 'paragraph', '  \n\t  ')], {
        displayScope: 'line', speedPerMinute: 5000,
    });
    assert.deepEqual(result.frames, []);
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

test('speed-only changes preserve frame text, IDs, units and identity while changing durations', () => {
    const input = [node('p1', 0, 'paragraph', '中文 alpha beta 12.5% gamma')];
    const base = { displayScope: 'line', lineWidth: 12, maxLines: 2 };
    const slow = Adapter.buildPlaybackFrames(documentView, input, { ...base, speedPerMinute: 600 });
    const fast = Adapter.buildPlaybackFrames(documentView, input, { ...base, speedPerMinute: 1200 });
    assert.deepEqual(
        slow.frames.map(({ duration_ms, ...frame }) => frame),
        fast.frames.map(({ duration_ms, ...frame }) => frame),
    );
    assert.deepEqual(slow.frames.map((frame) => frame.frame_id), fast.frames.map((frame) => frame.frame_id));
    assert.ok(slow.frames.some((frame, index) => frame.duration_ms !== fast.frames[index].duration_ms));
});

test('frame reading units are recomputed from final emitted frame text', () => {
    const result = Adapter.buildPlaybackFrames(documentView, [
        node('p1', 0, 'paragraph', '中文 alpha beta 12.5%'),
    ], { displayScope: 'line', lineWidth: 10, speedPerMinute: 600 });
    for (const frame of result.frames) {
        assert.equal(frame.reading_units, Adapter.countReadingUnits(frame.text));
    }
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
    for (const forbidden of [
        'state.content', 'cachedContentBlob', 'tokenizeContent(', 'CONTENT_DELIMITER', '/api/v1/books/',
        '/api/reader/v1', 'imageMarkerMap', 'page_id', 'presentation_id',
    ]) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
});