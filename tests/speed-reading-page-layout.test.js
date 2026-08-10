const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Adapter = require('../speed-reading-adapter.js');
const StructurePolicy = require('../speed-reading-structure-policy.js');
const Layout = require('../speed-reading-responsive-layout.js');

if (!Adapter.__structurePolicyInstalled) {
    StructurePolicy.install({ SpeedReadingAdapter: Adapter });
}

const documentView = {
    contract_version: '2',
    document_ref: 'doc-page-layout',
    candidate_id: 'cand-page-layout',
    candidate_schema_id: 'atlas.structured-content-v2',
    candidate_schema_version: 2,
    source_units: [{ source_unit_id: 'su-1', source_order: 0, kind: 'text_flow' }],
};

function node(id, order, type, text, extra = {}) {
    const sourceUnitId = extra.sourceUnitId || 'su-1';
    return {
        node_id: id,
        order,
        node_type: type,
        text,
        source_unit_ids: [sourceUnitId],
        location: {
            node_id: id,
            source_unit_id: sourceUnitId,
            source_anchor: { kind: 'text_span', start: order * 100, end: order * 100 + String(text || '').length },
        },
        ...extra,
    };
}

function measure(text, nodeType = 'paragraph', headingLevel = null) {
    const scale = Layout.fontScaleFor(nodeType, headingLevel);
    let width = 0;
    for (const char of String(text || '')) {
        if (/\p{Script=Han}/u.test(char)) width += 10;
        else if (/[A-Za-z0-9]/u.test(char)) width += 6;
        else if (/\s/u.test(char)) width += 3;
        else width += 5;
    }
    return width * scale;
}

function build(nodes, options = {}, view = documentView) {
    return Layout.buildMeasuredPlaybackFrames(Adapter, view, nodes, {
        displayScope: 'page',
        widthPercent: 100,
        maxWidthPx: 100,
        pageLineCapacity: 4,
        pageHeightPx: 100,
        lineHeightPx: 20,
        fontSizePx: 20 / Layout.DEFAULT_LINE_HEIGHT_RATIO,
        speedPerMinute: 600,
        measureText: measure,
        ...options,
    });
}

function timedFrames(result) {
    return result.frames.filter((frame) => frame.kind === 'timed_text');
}

function grouping(result) {
    return result.frames.map((frame) => ({
        kind: frame.kind,
        text: frame.text,
        page: frame.placement?.virtual_page_index,
    }));
}

test('Page automatically packs ordinary body rows by measured page height', () => {
    const result = build([node('p1', 0, 'paragraph', '汉'.repeat(60))], { pageHeightPx: 45 });
    assert.ok(timedFrames(result).length > 1);
    assert.ok(timedFrames(result).every((frame) => frame.placement.content_height_px <= 45.01));
    assert.ok(timedFrames(result).every((frame) => frame.placement.display_scope === 'page'));
});

test('larger font and smaller reading height both reduce Page text capacity', () => {
    const nodes = [node('p1', 0, 'paragraph', '汉'.repeat(80))];
    const normal = build(nodes, { pageHeightPx: 100, lineHeightPx: 20, fontSizePx: 20 / 1.55 });
    const larger = build(nodes, { pageHeightPx: 100, lineHeightPx: 32, fontSizePx: 32 / 1.55 });
    const shorter = build(nodes, { pageHeightPx: 55, lineHeightPx: 20, fontSizePx: 20 / 1.55 });
    assert.ok(timedFrames(larger).length > timedFrames(normal).length);
    assert.ok(timedFrames(shorter).length > timedFrames(normal).length);
});

test('narrower Page line width causes more wrapping and less text per page', () => {
    const nodes = [node('p1', 0, 'paragraph', '汉'.repeat(80))];
    const wide = build(nodes, { widthPercent: 100, maxWidthPx: 100, pageHeightPx: 100 });
    const narrow = build(nodes, { widthPercent: 50, maxWidthPx: 100, pageHeightPx: 100 });
    assert.ok(timedFrames(narrow).length > timedFrames(wide).length);
    assert.equal(narrow.options.lineWidthPx, 50);
});

test('H1 and H2 consume more measured Page row height than body text', () => {
    const body = Layout.measuredRowMetrics({ node_type: 'paragraph' }, { baseFontSizePx: 20, baseLineHeightPx: 31 });
    const h1 = Layout.measuredRowMetrics({ node_type: 'heading', heading_level: 1 }, { baseFontSizePx: 20, baseLineHeightPx: 31 });
    const h2 = Layout.measuredRowMetrics({ node_type: 'heading', heading_level: 2 }, { baseFontSizePx: 20, baseLineHeightPx: 31 });
    assert.ok(h1.row_height_px > body.row_height_px);
    assert.ok(h2.row_height_px > body.row_height_px);
    assert.ok(h1.row_height_px > h2.row_height_px);
});

test('title plus body pagination preserves semantic rows and naturally reduces remaining body capacity', () => {
    const result = build([
        node('title', 0, 'title', 'Measured title'),
        node('body', 1, 'paragraph', '汉'.repeat(30)),
    ], { pageHeightPx: 55 });
    const pages = timedFrames(result);
    assert.ok(pages.length >= 2);
    assert.equal(pages[0].lines[0].node_type, 'title');
    assert.ok(pages[0].lines[0].row_height_px > pages.at(-1).lines.at(-1).row_height_px);
});

test('canonical top-level TOC title uses title typography while TOC entries remain list-item typography', () => {
    const result = build([
        node('toc-title', 0, 'toc', '目录'),
        node('toc-entry', 1, 'toc_item', '第一章....1'),
    ], { pageHeightPx: 120, maxWidthPx: 300 });
    const rows = timedFrames(result).flatMap((frame) => frame.lines);
    const title = rows.find((line) => line.identity?.node_id === 'toc-title');
    const entry = rows.find((line) => line.identity?.node_id === 'toc-entry');
    assert.equal(title?.node_type, 'title');
    assert.equal(title?.toc_title, true);
    assert.equal(entry?.node_type, 'list_item');
    assert.notEqual(entry?.toc_title, true);
    assert.ok(title.row_height_px > entry.row_height_px);
});

test('English lexical words never split across Page rows even when one word is wider than the line', () => {
    const result = build([node('p1', 0, 'paragraph', 'alpha extraordinary beta')], {
        widthPercent: 30,
        maxWidthPx: 100,
        pageHeightPx: 200,
    });
    const lines = timedFrames(result).flatMap((frame) => frame.lines.map((line) => line.text));
    assert.ok(lines.includes('extraordinary'));
    assert.equal(lines.filter((line) => line.includes('extraordinary')).length, 1);
});

test('Figure, Table, and display Formula terminate a partial Page and following text starts on a fresh virtual page', () => {
    for (const [type, metadata] of [
        ['figure', {}],
        ['table', {}],
        ['formula', { provider_block_label: 'display_formula' }],
    ]) {
        const result = build([
            node(`before-${type}`, 0, 'paragraph', '汉'.repeat(15)),
            node(`visual-${type}`, 1, type, `${type} visual`, { metadata }),
            node(`after-${type}`, 2, 'paragraph', '汉'.repeat(10)),
        ], { pageHeightPx: 100 });
        assert.deepEqual(result.frames.map((frame) => frame.kind), ['timed_text', 'manual', 'timed_text'], type);
        assert.deepEqual(result.frames.map((frame) => frame.placement.virtual_page_index), [0, 1, 2], type);
        assert.equal(result.frames[0].lines.length, 2, `${type} ends the partial text page`);
        assert.equal(result.frames[2].lines.length, 1, `${type} after-text starts on a new page`);
    }
});

test('inline formula stays inside timed Page text flow and does not create a manual boundary', () => {
    const result = build([
        node('before', 0, 'paragraph', 'alpha'),
        node('inline', 1, 'formula', 'x+y', { metadata: { provider_block_label: 'inline_formula' } }),
        node('after', 2, 'paragraph', 'beta'),
    ], { pageHeightPx: 200, maxWidthPx: 300 });
    assert.ok(result.frames.every((frame) => frame.kind === 'timed_text'));
    assert.ok(result.frames.some((frame) => frame.source_spans.some((span) => span.node_id === 'inline')));
});

test('Page grouping is identical for Focus and Moving viewpoints', () => {
    const nodes = [
        node('h', 0, 'heading', 'Heading', { heading_level: 2 }),
        node('p', 1, 'paragraph', '汉'.repeat(60)),
    ];
    const focus = build(nodes, { readingMode: 'focus' });
    const moving = build(nodes, { readingMode: 'moving' });
    assert.deepEqual(grouping(focus), grouping(moving));
});

test('legacy maxLines and pageMaxLines values do not influence Reader v2 Page grouping', () => {
    const nodes = [node('p1', 0, 'paragraph', '汉'.repeat(70))];
    const one = build(nodes, { maxLines: 1, pageMaxLines: 1 });
    const many = build(nodes, { maxLines: 99, pageMaxLines: 99 });
    assert.deepEqual(grouping(one), grouping(many));
});

test('speed-only changes preserve Page grouping while duration continues to use adapter timing math', () => {
    const nodes = [node('p1', 0, 'paragraph', 'alpha beta 中文'.repeat(10))];
    const slow = build(nodes, { speedPerMinute: 600 });
    const fast = build(nodes, { speedPerMinute: 1200 });
    assert.deepEqual(grouping(slow), grouping(fast));
    assert.ok(timedFrames(fast)[0].duration_ms < timedFrames(slow)[0].duration_ms);
    for (const frame of timedFrames(fast)) {
        assert.equal(frame.duration_ms, Adapter.frameDurationMs(frame.reading_units, 1200));
    }
});

test('virtual Page flow crosses original PDF physical-page boundaries instead of restoring source PDF pages', () => {
    const pdfView = {
        ...documentView,
        source_units: [
            { source_unit_id: 'pdf-1', source_order: 0, kind: 'physical_page' },
            { source_unit_id: 'pdf-2', source_order: 1, kind: 'physical_page' },
        ],
    };
    const result = build([
        node('p1', 0, 'paragraph', 'alpha beta', { sourceUnitId: 'pdf-1' }),
        node('p2', 1, 'paragraph', 'gamma delta', { sourceUnitId: 'pdf-2' }),
    ], { pageHeightPx: 200, maxWidthPx: 400 }, pdfView);
    assert.equal(timedFrames(result).length, 1);
    assert.ok(timedFrames(result)[0].source_spans.some((span) => span.source_unit_id === 'pdf-1'));
    assert.ok(timedFrames(result)[0].source_spans.some((span) => span.source_unit_id === 'pdf-2'));
});

test('responsive Page runtime reflows on geometry/font changes and preserves semantic identity', () => {
    const source = fs.readFileSync(require.resolve('../speed-reading-responsive-layout.js'), 'utf8');
    assert.match(source, /pageHeightBudget\(this\.playbackAvailableHeight\(\)/u);
    assert.match(source, /reader-study-tools-layout-change/u);
    assert.match(source, /ResizeObserver/u);
    assert.match(source, /controller\.element\('pageModeDisplay'\)/u);
    assert.match(source, /controller\.refreshFrames\(\{ preserveIdentity: true \}\)/u);
    assert.match(source, /'fontInput'.*'fontSlider'.*'fontWeight'/su);
    assert.match(source, /'widthInput'.*'widthSlider'.*'displayMode'/su);
});
