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

function withSourceUnits(sourceUnits) {
    return { ...documentView, source_units: sourceUnits };
}

function sourceUnit(id, order, kind) {
    return { source_unit_id: id, source_order: order, kind };
}

function node(id, order, type, text, sourceUnitId = 'su-1') {
    return {
        node_id: id,
        order,
        node_type: type,
        text,
        source_unit_ids: [sourceUnitId],
        location: {
            node_id: id,
            source_unit_id: sourceUnitId,
            source_anchor: { kind: 'text_span', start: order * 10, end: order * 10 + String(text || '').length },
        },
    };
}

function lineTexts(text, width) {
    return Adapter.tokensToLines(Adapter.tokenizeReadingText(text), width)
        .map((line) => line.tokens.map((token) => token.text).join(''));
}

function stripDuration(frame) {
    const { duration_ms, ...rest } = frame;
    return rest;
}

test('counts CJK as one unit and Latin lexical tokens as three units', () => {
    assert.equal(Adapter.countReadingUnits('中文'), 2);
    assert.equal(Adapter.countReadingUnits('hello'), 3);
    assert.equal(Adapter.countReadingUnits('中 hello 文 world'), 8);
    assert.equal(Adapter.countReadingUnits("don't state-of-the-art"), 6);
    assert.equal(Adapter.countReadingUnits('12.5% 2026-07-27'), 6);
});

test('tokenizes representative mixed-language text deterministically', () => {
    for (const sample of [
        '这是中文。下一句！',
        "Don't split state-of-the-art words.",
        '中文English混排AI模型2026年。',
        'Email test@example.com or visit https://example.com/path.',
    ]) {
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

test('long English token wider than configured line remains whole', () => {
    const texts = lineTexts('one extraordinary two', 5);
    assert.ok(texts.includes('extraordinary'));
    assert.equal(texts.filter((text) => text.includes('extraordinary')).length, 1);
});

test('spaces are preserved while wrapped leading spaces are removed', () => {
    assert.deepEqual(lineTexts('alpha beta', 20), ['alpha beta']);
    const wrapped = lineTexts('alpha beta gamma', 3);
    assert.deepEqual(wrapped, ['alpha', 'beta', 'gamma']);
    assert.ok(wrapped.every((line) => !line.startsWith(' ') && !line.endsWith(' ')));
});

test('explicit newlines remain hard boundaries for generic tokenization', () => {
    assert.deepEqual(lineTexts('alpha\n\nbeta\r\n中文', 40), ['alpha', 'beta', '中文']);
});

test('OCR soft wraps are normalized only when requested by playback construction', () => {
    assert.equal(Adapter.normalizeSoftWraps('这是一个\n连续中文句子'), '这是一个连续中文句子');
    assert.equal(Adapter.normalizeSoftWraps('Google\nResearch'), 'Google Research');
    assert.deepEqual(lineTexts('Google\nResearch', 40), ['Google', 'Research']);
});

test('avoidable closing punctuation stays attached to preceding line', () => {
    const cjk = lineTexts('你好，世界。', 2);
    assert.equal(cjk[0], '你好，');
    assert.equal(cjk.some((line) => line.startsWith('，') || line.startsWith('。')), false);
    const latin = lineTexts('hello, world!', 5);
    assert.equal(latin[0], 'hello,');
});

test('duration formula honors speed and safe floors', () => {
    assert.equal(Adapter.durationMs(10, 600), 1000);
    assert.equal(Adapter.durationMs(0, 600), 1000 / 6);
    const punctuation = Adapter.buildPlaybackFrames(documentView, [node('punct', 0, 'paragraph', '...')], {
        displayScope: 'line', lineWidth: 10, speedPerMinute: 5000,
    });
    assert.equal(punctuation.frames[0].duration_ms, Adapter.ZERO_UNIT_FRAME_DURATION_MS);
});

test('whitespace-only text does not emit timed frames', () => {
    const result = Adapter.buildPlaybackFrames(documentView, [node('blank', 0, 'paragraph', '  \n\t  ')], {
        displayScope: 'line', speedPerMinute: 5000,
    });
    assert.deepEqual(result.frames, []);
});

test('manual semantic nodes remain standalone non-auto-advance frames', () => {
    const result = Adapter.buildPlaybackFrames(documentView, [
        node('fig', 0, 'figure', 'Figure 1'),
        node('tbl', 1, 'table', 'Table 1'),
        node('formula', 2, 'formula', 'E=mc2'),
    ], { displayScope: 'line', speedPerMinute: 5000 });
    assert.deepEqual(result.frames.map((frame) => frame.kind), ['manual', 'manual', 'manual']);
    assert.ok(result.frames.every((frame) => frame.auto_advance === false && frame.duration_ms === null));
});

test('block, line and page scopes are deterministic and preserve semantic identity', () => {
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
        assert.ok(first.frames.every((frame) => !frame.frame_id.includes('page')));
    }
});

test('page scope packs bounded complete lines without splitting English words', () => {
    const result = Adapter.buildPlaybackFrames(documentView, [
        node('p1', 0, 'paragraph', 'one extraordinary two three four five'),
    ], { displayScope: 'page', lineWidth: 6, maxLines: 2, speedPerMinute: 600 });
    const joined = result.frames.map((frame) => frame.text).join('\n');
    assert.equal((joined.match(/extraordinary/g) || []).length, 1);
});

test('PDF physical-page boundaries do not flush a continuation line or frame', () => {
    const pdf = withSourceUnits([
        sourceUnit('pdf-p1', 0, 'physical_page'),
        sourceUnit('pdf-p2', 1, 'physical_page'),
    ]);
    const result = Adapter.buildPlaybackFrames(pdf, [
        node('p1', 0, 'paragraph', '跨页但没有结束的', 'pdf-p1'),
        node('p2', 1, 'paragraph', '完整句子。', 'pdf-p2'),
    ], { displayScope: 'line', lineWidth: 35, maxLines: 3, speedPerMinute: 600 });

    assert.equal(Adapter.hasPhysicalPageSemantics(pdf), true);
    assert.equal(result.frames.length, 1);
    assert.equal(result.frames[0].lines.length, 1);
    assert.equal(result.frames[0].text, '跨页但没有结束的完整句子。');
    assert.deepEqual(result.frames[0].source_spans.map((span) => span.source_unit_id), ['pdf-p1', 'pdf-p2']);
});

test('completed paragraphs remain separate even when source page changes', () => {
    const pdf = withSourceUnits([
        sourceUnit('pdf-p1', 0, 'physical_page'),
        sourceUnit('pdf-p2', 1, 'physical_page'),
    ]);
    const result = Adapter.buildPlaybackFrames(pdf, [
        node('p1', 0, 'paragraph', '第一段已经结束。', 'pdf-p1'),
        node('p2', 1, 'paragraph', '第二段开始。', 'pdf-p2'),
    ], { displayScope: 'line', lineWidth: 35, maxLines: 3, speedPerMinute: 600 });
    assert.equal(result.frames[0].lines.length, 2);
});

test('Paddle running furniture and marginal labels are excluded without numeric heuristics', () => {
    const nodes = [
        node('header', 0, 'header', 'Book title'),
        node('number', 1, 'number', '12'),
        node('header-image', 2, 'header_image', 'decorative mark'),
        node('aside', 3, 'aside_text', 'side note'),
        node('footnote', 4, 'footnote', 'footnote text'),
        node('body', 5, 'paragraph', '正文 2026 第 12 节'),
        node('footer', 6, 'footer', 'publisher'),
        node('footer-image', 7, 'footer_image', 'decorative mark'),
    ];
    const result = Adapter.buildPlaybackFrames(documentView, nodes, {
        displayScope: 'line', lineWidth: 35, maxLines: 3, speedPerMinute: 600,
    });
    assert.deepEqual(result.elements.map((element) => element.identity.node_id), ['body']);
    assert.equal(result.frames.map((frame) => frame.text).join('\n'), '正文 2026 第 12 节');
});

test('manual content is the explicit boundary inside a cross-page flow', () => {
    const pdf = withSourceUnits([
        sourceUnit('pdf-p1', 0, 'physical_page'),
        sourceUnit('pdf-p2', 1, 'physical_page'),
    ]);
    const result = Adapter.buildPlaybackFrames(pdf, [
        node('before', 0, 'paragraph', 'Before', 'pdf-p1'),
        node('fig', 1, 'figure', 'Figure 1', 'pdf-p2'),
        node('after', 2, 'paragraph', 'After', 'pdf-p2'),
    ], { displayScope: 'line', speedPerMinute: 600 });
    assert.deepEqual(result.frames.map((frame) => frame.kind), ['timed_text', 'manual', 'timed_text']);
});

test('line scope groups continuous visual lines by configured line count', () => {
    const result = Adapter.buildPlaybackFrames(documentView, [
        node('a', 0, 'paragraph', '第一段已经结束。'),
        node('b', 1, 'paragraph', '第二段已经结束。'),
        node('c', 2, 'paragraph', '第三段已经结束。'),
        node('d', 3, 'paragraph', '第四段已经结束。'),
    ], { displayScope: 'line', lineWidth: 35, maxLines: 3, speedPerMinute: 600 });
    assert.equal(result.frames.length, 2);
    assert.equal(result.frames[0].lines.length, 3);
    assert.equal(result.frames[1].lines.length, 1);
});

test('35 CJK characters occupy 35 logical display cells', () => {
    const text = '汉'.repeat(35);
    assert.equal(Adapter.displayWidth(text), 35);
    assert.equal(Adapter.tokensToLines(Adapter.tokenizeReadingText(text), 35).length, 1);
    assert.equal(Adapter.tokensToLines(Adapter.tokenizeReadingText(`${text}汉`), 35).length, 2);
});

test('title and body hierarchy survives frame construction', () => {
    const result = Adapter.buildPlaybackFrames(documentView, [
        node('title', 0, 'title', '浪潮之巅'),
        node('body', 1, 'paragraph', '正文内容'),
    ], { displayScope: 'line', lineWidth: 35, maxLines: 3, speedPerMinute: 600 });
    assert.deepEqual(result.frames[0].lines.map((line) => line.node_type), ['title', 'paragraph']);
});

test('speed-only changes preserve grouping, IDs, text and identities', () => {
    const input = [node('p1', 0, 'paragraph', '中文 alpha beta 12.5% gamma')];
    const base = { displayScope: 'line', lineWidth: 12, maxLines: 2 };
    const slow = Adapter.buildPlaybackFrames(documentView, input, { ...base, speedPerMinute: 600 });
    const fast = Adapter.buildPlaybackFrames(documentView, input, { ...base, speedPerMinute: 1200 });
    assert.deepEqual(slow.frames.map(stripDuration), fast.frames.map(stripDuration));
    assert.ok(slow.frames.some((frame, index) => frame.duration_ms !== fast.frames[index].duration_ms));
});

test('frame reading units are recomputed from final emitted text', () => {
    const result = Adapter.buildPlaybackFrames(documentView, [
        node('p1', 0, 'paragraph', '中文 alpha beta 12.5%'),
    ], { displayScope: 'line', lineWidth: 10, speedPerMinute: 600 });
    for (const frame of result.frames) assert.equal(frame.reading_units, Adapter.countReadingUnits(frame.text));
});

test('typed source location identity is retained on elements, lines, and frames', () => {
    const input = node('p1', 0, 'paragraph', 'hello 世界', 'text-flow-1');
    input.location.source_anchor = { kind: 'text_span', start: 12, end: 20 };
    const result = Adapter.buildPlaybackFrames(documentView, [input], { displayScope: 'line', speedPerMinute: 600 });
    assert.deepEqual(result.elements[0].identity.source_anchor, { kind: 'text_span', start: 12, end: 20 });
    assert.deepEqual(result.frames[0].source_spans[0].source_anchor, { kind: 'text_span', start: 12, end: 20 });
});

test('adapter source has no legacy presentation-page dependencies', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(require.resolve('../speed-reading-adapter.js'), 'utf8');
    for (const forbidden of [
        'state.content', 'cachedContentBlob', 'tokenizeContent(', 'CONTENT_DELIMITER', '/api/v1/books/',
        '/api/reader/v1', 'imageMarkerMap', 'page_id', 'presentation_id', 'scroll_offset', 'token_index',
    ]) assert.equal(source.includes(forbidden), false, forbidden);
});