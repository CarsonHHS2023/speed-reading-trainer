const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Adapter = require('../speed-reading-adapter.js');
const Layout = require('../speed-reading-responsive-layout.js');

const documentView = {
    contract_version: '2',
    document_ref: 'doc-responsive',
    candidate_id: 'cand-responsive',
    candidate_schema_id: 'atlas.structured-content-v2',
    candidate_schema_version: 2,
    source_units: [{ source_unit_id: 'su-1', source_order: 0, kind: 'text_flow' }],
};

function node(id, order, type, text) {
    return {
        node_id: id,
        order,
        node_type: type,
        text,
        source_unit_ids: ['su-1'],
        location: {
            node_id: id,
            source_unit_id: 'su-1',
            source_anchor: { kind: 'text_span', start: order * 10, end: order * 10 + text.length },
        },
    };
}

function multilingualMeasure(text, nodeType = 'paragraph') {
    const scale = nodeType === 'title' ? 1.5 : nodeType === 'heading' ? 1.22 : 1;
    let width = 0;
    for (const char of String(text || '')) {
        if (/\p{Script=Han}/u.test(char)) width += 10;
        else if (/[A-Za-z0-9]/u.test(char)) width += 6;
        else if (/\s/u.test(char)) width += 3;
        else width += 5;
    }
    return width * scale;
}

test('display width percentage is clamped and defaults to 100 percent', () => {
    assert.equal(Layout.clampWidthPercent(undefined), 100);
    assert.equal(Layout.clampWidthPercent(20), 30);
    assert.equal(Layout.clampWidthPercent(75), 75);
    assert.equal(Layout.clampWidthPercent(150), 100);
    assert.equal(Layout.targetWidthPx(1000, 100, 32), 968);
    assert.equal(Layout.targetWidthPx(1000, 50, 32), 484);
});

test('measured wrapping adapts to mixed-language glyph widths instead of logical character cells', () => {
    const elements = Adapter.buildReadingElements(documentView, [
        node('p1', 0, 'paragraph', '中文 alpha beta'),
    ]);
    const narrow = Layout.buildMeasuredLines(Adapter, elements, 70, multilingualMeasure);
    const wide = Layout.buildMeasuredLines(Adapter, elements, 140, multilingualMeasure);
    assert.ok(narrow.length > wide.length);
    assert.equal(wide.map((line) => line.text).join(''), '中文 alpha beta');
    assert.ok(narrow.every((line) => line.measured_width_px <= 70 || line.text === 'alpha' || line.text === 'beta'));
});

test('font hierarchy participates in measurement so titles wrap sooner than body text', () => {
    const title = Adapter.buildReadingElements(documentView, [node('title', 0, 'title', 'Responsive title')]);
    const body = Adapter.buildReadingElements(documentView, [node('body', 0, 'paragraph', 'Responsive title')]);
    const titleLines = Layout.buildMeasuredLines(Adapter, title, 90, multilingualMeasure);
    const bodyLines = Layout.buildMeasuredLines(Adapter, body, 90, multilingualMeasure);
    assert.ok(titleLines.length >= bodyLines.length);
    assert.ok(titleLines[0].measured_width_px >= bodyLines[0].measured_width_px || titleLines.length > bodyLines.length);
});

test('measured frame builder preserves configured line count and semantic identity', () => {
    const result = Layout.buildMeasuredPlaybackFrames(Adapter, documentView, [
        node('a', 0, 'paragraph', '第一段已经结束。'),
        node('b', 1, 'paragraph', 'Second paragraph ends.'),
        node('c', 2, 'paragraph', '第三段已经结束。'),
    ], {
        displayScope: 'line',
        widthPercent: 100,
        maxWidthPx: 120,
        maxLines: 2,
        speedPerMinute: 600,
        measureText: multilingualMeasure,
    });
    assert.ok(result.frames.every((frame) => frame.lines.length <= 2));
    assert.equal(result.frames[0].identity.candidate_id, 'cand-responsive');
    assert.equal(result.options.widthPercent, 100);
    assert.equal(result.options.maxWidthPx, 120);
});

test('responsive stylesheet and HTML expose percentage width with default 100', () => {
    const css = fs.readFileSync(require.resolve('../speed-reading-v2.css'), 'utf8');
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.match(css, /--speed-reading-width-percent:\s*100%/u);
    assert.doesNotMatch(css, /--speed-reading-measure:\s*35em/u);
    assert.match(html, /id="widthSlider"[^>]*min="30"[^>]*max="100"[^>]*value="100"/u);
    assert.match(html, /id="widthInput"[^>]*min="30"[^>]*max="100"[^>]*value="100"/u);
});
