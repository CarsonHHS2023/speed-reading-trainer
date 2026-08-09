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
            source_anchor: { kind: 'text_span', start: order * 100, end: order * 100 + String(text || '').length },
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

function build(nodes, options = {}) {
    return Layout.buildMeasuredPlaybackFrames(Adapter, documentView, nodes, {
        displayScope: 'line',
        widthPercent: 100,
        maxWidthPx: 100,
        lineCount: 1,
        pageLineCapacity: 10,
        lineHeightPx: 20,
        speedPerMinute: 600,
        measureText: multilingualMeasure,
        ...options,
    });
}

test('display width percentage is clamped to the product contract of 20 through 100 percent', () => {
    assert.equal(Layout.MIN_WIDTH_PERCENT, 20);
    assert.equal(Layout.MAX_WIDTH_PERCENT, 100);
    assert.equal(Layout.clampWidthPercent(undefined), 100);
    assert.equal(Layout.clampWidthPercent(10), 20);
    assert.equal(Layout.clampWidthPercent(20), 20);
    assert.equal(Layout.clampWidthPercent(75), 75);
    assert.equal(Layout.clampWidthPercent(150), 100);
    assert.equal(Layout.targetWidthPx(1000, 100, 32), 968);
    assert.equal(Layout.targetWidthPx(1000, 50, 32), 484);
});

test('page capacity is derived from available reading height and line height', () => {
    assert.equal(Layout.pageLineCapacity(500, 40, 100), 10);
    assert.equal(Layout.pageLineCapacity(200, 40, 40), 4);
    assert.equal(Layout.pageLineCapacity(20, 40, 72), 1);
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

test('font hierarchy participates in measurement so titles remain structurally distinct from body text', () => {
    const title = Adapter.buildReadingElements(documentView, [node('title', 0, 'title', 'Responsive title')]);
    const body = Adapter.buildReadingElements(documentView, [node('body', 0, 'paragraph', 'Responsive title')]);
    const titleLines = Layout.buildMeasuredLines(Adapter, title, 90, multilingualMeasure);
    const bodyLines = Layout.buildMeasuredLines(Adapter, body, 90, multilingualMeasure);
    assert.equal(titleLines.length, 1);
    assert.equal(titleLines[0].structural_single_row, true);
    assert.ok(titleLines[0].measured_width_px > bodyLines[0].measured_width_px);
});

test('title, heading, and list items are atomic rows and are not block-sliced', () => {
    for (const type of ['title', 'heading', 'list_item']) {
        const result = build([node(type, 0, type, '结构标题内容')], {
            displayScope: 'block',
            widthPercent: 20,
        });
        assert.equal(result.frames.length, 1, type);
        assert.equal(result.frames[0].text, '结构标题内容');
        assert.equal(result.frames[0].placement.structural_single_row, true);
    }
});

test('block scope lays out full visual lines first, then slices each line without crossing the line boundary', () => {
    const result = build([node('p1', 0, 'paragraph', '汉'.repeat(13))], {
        displayScope: 'block',
        widthPercent: 50,
        maxWidthPx: 100,
        pageLineCapacity: 10,
    });
    assert.deepEqual(result.frames.map((frame) => frame.text), ['汉'.repeat(5), '汉'.repeat(5), '汉'.repeat(3)]);
    assert.deepEqual(result.frames.map((frame) => frame.placement.line_index), [0, 0, 1]);
    assert.deepEqual(result.frames.map((frame) => frame.placement.x_px), [0, 50, 0]);
    assert.equal(result.options.lineWidthPx, 100, 'block scope keeps the full visual line width');
    assert.equal(result.options.blockWidthPx, 50, 'block width is the configured percentage of the reading width');
});

test('English lexical tokens remain whole even when one word is wider than the configured block', () => {
    const result = build([node('p1', 0, 'paragraph', 'alpha extraordinary beta')], {
        displayScope: 'block',
        widthPercent: 30,
        maxWidthPx: 100,
    });
    const texts = result.frames.map((frame) => frame.text);
    assert.equal(texts.filter((text) => text.includes('extraordinary')).length, 1);
    assert.ok(texts.includes('extraordinary'));
});

test('line scope uses the configured percentage as line width and groups only complete visual lines', () => {
    const result = build([node('p1', 0, 'paragraph', '汉'.repeat(20))], {
        displayScope: 'line',
        widthPercent: 50,
        maxWidthPx: 100,
        lineCount: 2,
        pageLineCapacity: 10,
    });
    assert.equal(result.options.lineWidthPx, 50);
    assert.deepEqual(result.frames.map((frame) => frame.lines.length), [2, 2]);
    assert.ok(result.frames.every((frame) => frame.text.split('\n').every((line) => line.length === 5)));
});

test('line frames do not straddle a virtual page boundary in moving geometry', () => {
    const result = build([node('p1', 0, 'paragraph', '汉'.repeat(40))], {
        displayScope: 'line',
        widthPercent: 100,
        maxWidthPx: 100,
        lineCount: 2,
        pageLineCapacity: 3,
    });
    assert.deepEqual(result.frames.map((frame) => frame.lines.length), [2, 1, 1]);
    assert.deepEqual(result.frames.map((frame) => frame.placement.virtual_page_index), [0, 0, 1]);
    assert.deepEqual(result.frames.map((frame) => frame.placement.line_index), [0, 2, 0]);
});

test('page scope is text reflow for every source type and uses automatic page-line capacity', () => {
    const result = build([node('p1', 0, 'paragraph', '汉'.repeat(50))], {
        displayScope: 'page',
        widthPercent: 100,
        maxWidthPx: 100,
        pageLineCapacity: 2,
    });
    assert.deepEqual(result.frames.map((frame) => frame.lines.length), [2, 2, 1]);
    assert.deepEqual(result.frames.map((frame) => frame.placement.virtual_page_index), [0, 1, 2]);
    assert.ok(result.frames.every((frame) => frame.placement.display_scope === 'page'));
});

test('manual figure/table/formula frames terminate the current text page and following text starts on a fresh page', () => {
    const result = build([
        node('before', 0, 'paragraph', '汉'.repeat(15)),
        node('figure', 1, 'figure', 'Figure 1'),
        node('after', 2, 'paragraph', '汉'.repeat(10)),
    ], {
        displayScope: 'page',
        widthPercent: 100,
        maxWidthPx: 100,
        pageLineCapacity: 3,
    });
    assert.deepEqual(result.frames.map((frame) => frame.kind), ['timed_text', 'manual', 'timed_text']);
    assert.deepEqual(result.frames.map((frame) => frame.placement.virtual_page_index), [0, 1, 2]);
    assert.equal(result.frames[0].lines.length, 2, 'the partial page ends before the visual');
    assert.equal(result.frames[2].lines.length, 1, 'text after the visual starts a new page');
});

test('runtime settings layer owns the 20-100 percent range and removes the old manual page-line setting', () => {
    const source = fs.readFileSync(require.resolve('../speed-reading-responsive-layout.js'), 'utf8');
    assert.match(source, /const MIN_WIDTH_PERCENT = 20;/u);
    assert.match(source, /control\.min = String\(MIN_WIDTH_PERCENT\)/u);
    assert.match(source, /pageSettings\.style\.display = 'none'/u);
    assert.match(source, /scope === 'block' \? '块宽：' : '行宽：'/u);
    assert.match(source, /blockOption\.textContent = '块'/u);
});
