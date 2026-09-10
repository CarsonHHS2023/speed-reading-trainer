const test = require('node:test');
const assert = require('node:assert/strict');

const Adapter = require('../speed-reading-adapter.js');
const StructurePolicy = require('../speed-reading-structure-policy.js');
const Layout = require('../speed-reading-responsive-layout.js');
const BlockPolicy = require('../speed-reading-block-layout-policy.js');

if (!Adapter.__structurePolicyInstalled) {
    StructurePolicy.install({ SpeedReadingAdapter: Adapter });
}

const textFlowDocument = {
    contract_version: '2',
    document_ref: 'doc-paragraph-layout',
    candidate_id: 'cand-paragraph-layout',
    candidate_schema_id: 'atlas.structured-content-v2',
    candidate_schema_version: 2,
    source_units: [{ source_unit_id: 'flow-1', source_order: 0, kind: 'text_flow' }],
};

function node(id, order, text, options = {}) {
    const sourceUnitId = options.sourceUnitId || 'flow-1';
    const start = options.start ?? order * 100;
    return {
        node_id: id,
        order,
        node_type: options.nodeType || 'paragraph',
        heading_level: options.headingLevel ?? null,
        text,
        source_unit_ids: [sourceUnitId],
        location: {
            node_id: id,
            source_unit_id: sourceUnitId,
            source_anchor: {
                kind: 'text_span',
                start,
                end: options.end ?? start + String(text || '').length,
            },
        },
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

function build(nodes, options = {}, documentView = textFlowDocument) {
    return Layout.buildMeasuredPlaybackFrames(Adapter, documentView, nodes, {
        displayScope: 'page',
        readingMode: 'focus',
        widthPercent: 100,
        maxWidthPx: 100,
        lineCount: 1,
        pageLineCapacity: 20,
        pageHeightPx: 400,
        lineHeightPx: 31,
        fontSizePx: 20,
        speedPerMinute: 600,
        measureText: measure,
        ...options,
    });
}

function timed(result) {
    return result.frames.filter((frame) => frame.kind === 'timed_text');
}

function rows(result) {
    return timed(result).flatMap((frame) => frame.lines || []);
}

test('paragraph first line reserves a measured two-em indent while continuation lines use the full width', () => {
    const elements = Adapter.buildReadingElements(textFlowDocument, [node('p1', 0, '汉'.repeat(18))]);
    const lines = Layout.buildMeasuredLines(Adapter, elements, 100, measure, {
        paragraphLayout: true,
        paragraphIndentPx: 40,
    });

    assert.deepEqual(lines.map((line) => line.text.length), [6, 10, 2]);
    assert.equal(lines[0].paragraph_start, true);
    assert.equal(lines[0].paragraph_indent_px, 40);
    assert.equal(lines[0].paragraph_id, 'p1');
    assert.notEqual(lines[1].paragraph_start, true);
});

test('distinct canonical paragraphs in one TXT text_flow keep paragraph boundaries, indentation, and measured spacing', () => {
    const result = build([
        node('p1', 0, '汉'.repeat(12), { start: 0 }),
        node('p2', 1, '汉'.repeat(12), { start: 20 }),
    ]);
    const allRows = rows(result);
    const starts = allRows.filter((line) => line.paragraph_start === true);

    assert.deepEqual(starts.map((line) => line.paragraph_id), ['p1', 'p2']);
    assert.ok(starts.every((line) => line.paragraph_indent_px === 40));
    assert.equal(starts[0].paragraph_gap_before_px, 0);
    assert.equal(starts[1].paragraph_gap_before_px, 9);
    assert.equal(result.options.paragraphIndentPx, 40);
    assert.equal(result.options.paragraphGapPx, 9);
    assert.equal(
        timed(result)[0].placement.content_height_px,
        Layout.measuredPageHeight(timed(result)[0].lines, result.options.rowGapPx),
    );
});

test('paragraph spacing participates in Page packing instead of being paint-only whitespace', () => {
    const content = [
        node('p1', 0, '汉'.repeat(4), { start: 0 }),
        node('p2', 1, '汉'.repeat(4), { start: 20 }),
    ];
    const withoutGap = build(content, { pageHeightPx: 67, paragraphGapPx: 0, rowGapPx: 4 });
    const withGap = build(content, { pageHeightPx: 67, paragraphGapPx: 9, rowGapPx: 4 });

    assert.equal(timed(withoutGap).length, 1);
    assert.equal(timed(withGap).length, 2);
    assert.equal(timed(withGap)[1].lines[0].paragraph_id, 'p2');
    assert.equal(timed(withGap)[1].placement.content_height_px, 31, 'top-of-page paragraph gap is not charged');
});

test('Line Focus and Moving preserve the same paragraph starts and first-line indentation', () => {
    const content = [
        node('p1', 0, '汉'.repeat(8), { start: 0 }),
        node('p2', 1, '汉'.repeat(8), { start: 20 }),
    ];
    const focus = build(content, { displayScope: 'line', readingMode: 'focus', pageLineCapacity: 20 });
    const moving = build(content, { displayScope: 'line', readingMode: 'moving', pageLineCapacity: 20 });

    const semantic = (result) => timed(result).map((frame) => frame.lines.map((line) => ({
        text: line.text,
        paragraph_start: line.paragraph_start === true,
        paragraph_id: line.paragraph_id || null,
        paragraph_indent_px: line.paragraph_indent_px || 0,
    })));
    assert.deepEqual(semantic(focus), semantic(moving));
    assert.deepEqual(rows(focus).filter((line) => line.paragraph_start).map((line) => line.paragraph_id), ['p1', 'p2']);
});

test('Line Moving geometry reserves paragraph separation before the next paragraph', () => {
    const result = build([
        node('p1', 0, '汉'.repeat(4), { start: 0 }),
        node('p2', 1, '汉'.repeat(4), { start: 20 }),
    ], { displayScope: 'line', readingMode: 'moving', pageLineCapacity: 20 });

    assert.equal(timed(result).length, 2);
    assert.equal(timed(result)[0].placement.y_px, 0);
    assert.equal(timed(result)[1].placement.y_px, 40, '31px line height + 9px paragraph gap');
    assert.equal(timed(result)[1].lines[0].paragraph_indent_px, 40);
});

test('Block Moving preserves paragraph indentation and paragraph vertical separation', () => {
    const result = build([
        node('p1', 0, '汉'.repeat(4), { start: 0 }),
        node('p2', 1, '汉'.repeat(4), { start: 20 }),
    ], {
        displayScope: 'block',
        readingMode: 'moving',
        widthPercent: 50,
        pageLineCapacity: 20,
    });
    const frames = timed(result);
    const paragraphStarts = frames.filter((frame) => frame.lines[0]?.paragraph_start === true);

    assert.equal(paragraphStarts.length, 2);
    assert.deepEqual(paragraphStarts.map((frame) => frame.lines[0].paragraph_id), ['p1', 'p2']);
    assert.deepEqual(paragraphStarts.map((frame) => frame.placement.x_px), [40, 40]);
    assert.deepEqual(paragraphStarts.map((frame) => frame.placement.y_px), [0, 40]);
});

test('Block Focus keeps its established continuous grouping without paragraph indentation', () => {
    const content = [
        node('p1', 0, '汉'.repeat(4), { start: 0 }),
        node('p2', 1, '汉'.repeat(4), { start: 20 }),
    ];
    const result = BlockPolicy.buildBlockAwarePlaybackFrames(
        Layout.buildMeasuredPlaybackFrames,
        Layout,
        Adapter,
        textFlowDocument,
        content,
        {
            displayScope: 'block',
            readingMode: 'focus',
            widthPercent: 50,
            maxWidthPx: 100,
            lineCount: 1,
            pageLineCapacity: 20,
            lineHeightPx: 31,
            fontSizePx: 20,
            speedPerMinute: 600,
            measureText: measure,
        },
    );

    assert.equal(result.options.paragraphLayout, false);
    assert.ok(timed(result).every((frame) => frame.lines.every((line) => line.paragraph_start !== true)));
    assert.equal(timed(result).map((frame) => frame.text).join(''), '汉'.repeat(8));
});

test('a paragraph that continues across original PDF physical pages is not indented again', () => {
    const pdfView = {
        ...textFlowDocument,
        source_units: [
            { source_unit_id: 'pdf-1', source_order: 0, kind: 'physical_page' },
            { source_unit_id: 'pdf-2', source_order: 1, kind: 'physical_page' },
        ],
    };
    const result = build([
        node('p1', 0, '连续段落前半', { sourceUnitId: 'pdf-1', start: 0 }),
        node('p2', 1, '继续到下一物理页', { sourceUnitId: 'pdf-2', start: 0 }),
    ], { maxWidthPx: 400, pageHeightPx: 300 }, pdfView);

    assert.equal(rows(result).filter((line) => line.paragraph_start === true).length, 1);
    assert.ok(timed(result)[0].source_spans.some((span) => span.source_unit_id === 'pdf-1'));
    assert.ok(timed(result)[0].source_spans.some((span) => span.source_unit_id === 'pdf-2'));
});

test('speed-only changes do not alter paragraph grouping or paragraph layout metadata', () => {
    const content = [
        node('p1', 0, '汉'.repeat(12), { start: 0 }),
        node('p2', 1, '汉'.repeat(12), { start: 20 }),
    ];
    const slow = build(content, { speedPerMinute: 600 });
    const fast = build(content, { speedPerMinute: 1200 });
    const signature = (result) => timed(result).map((frame) => frame.lines.map((line) => [
        line.text,
        line.paragraph_start === true,
        line.paragraph_id || null,
        line.paragraph_indent_px || 0,
        line.paragraph_gap_before_px || 0,
    ]));
    assert.deepEqual(signature(slow), signature(fast));
    assert.ok(timed(fast)[0].duration_ms < timed(slow)[0].duration_ms);
});
