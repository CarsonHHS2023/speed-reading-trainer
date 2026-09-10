const test = require('node:test');
const assert = require('node:assert/strict');

const Adapter = require('../speed-reading-adapter.js');
const StructurePolicy = require('../speed-reading-structure-policy.js');
const Layout = require('../speed-reading-responsive-layout.js');
const BlockPolicy = require('../speed-reading-block-layout-policy.js');

if (!Adapter.__structurePolicyInstalled) {
    StructurePolicy.install({ SpeedReadingAdapter: Adapter });
}

const documentView = {
    contract_version: '2',
    document_ref: 'doc-block-bottom-overflow',
    candidate_id: 'cand-block-bottom-overflow',
    candidate_schema_id: 'atlas.structured-content-v2',
    candidate_schema_version: 2,
    source_units: [{ source_unit_id: 'flow-1', source_order: 0, kind: 'text_flow' }],
};

function node(id, order, text, options = {}) {
    const start = options.start ?? order * 100;
    return {
        node_id: id,
        order,
        node_type: options.nodeType || 'paragraph',
        heading_level: options.headingLevel ?? null,
        text,
        source_unit_ids: ['flow-1'],
        location: {
            node_id: id,
            source_unit_id: 'flow-1',
            source_anchor: {
                kind: 'text_span',
                start,
                end: start + String(text || '').length,
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

function buildMoving(nodes, options = {}) {
    return BlockPolicy.buildBlockAwarePlaybackFrames(
        Layout.buildMeasuredPlaybackFrames,
        Layout,
        Adapter,
        documentView,
        nodes,
        {
            displayScope: 'block',
            readingMode: 'moving',
            widthPercent: 50,
            maxWidthPx: 100,
            lineCount: 1,
            pageLineCapacity: 20,
            pageHeightPx: 200,
            lineHeightPx: 31,
            fontSizePx: 20,
            speedPerMinute: 600,
            measureText: measure,
            ...options,
        },
    );
}

function timed(result) {
    return result.frames.filter((frame) => frame.kind === 'timed_text');
}

test('Block Moving starts a fresh virtual page before paragraph spacing would push the last row below the page budget', () => {
    const result = buildMoving([
        node('p1', 0, '汉'.repeat(4), { start: 0 }),
        node('p2', 1, '汉'.repeat(4), { start: 20 }),
    ], {
        pageLineCapacity: 2,
        pageHeightPx: 62,
        paragraphGapPx: 9,
    });
    const starts = timed(result).filter((frame) => frame.lines?.[0]?.paragraph_start === true);

    assert.equal(starts.length, 2);
    assert.deepEqual(starts.map((frame) => frame.placement.virtual_page_index), [0, 1]);
    assert.deepEqual(starts.map((frame) => frame.placement.y_px), [0, 0]);
    for (const frame of starts) {
        const bottom = frame.placement.y_px + BlockPolicy.blockRowHeightPx(frame, result, Layout);
        assert.ok(bottom <= result.options.pageHeightPx + 0.01);
    }
});

test('Block Moving accounts for a tall structural row before placing the following row', () => {
    const result = buildMoving([
        node('h1', 0, '第一章', { nodeType: 'heading', headingLevel: 1, start: 0 }),
        node('p1', 1, '汉'.repeat(4), { start: 20 }),
    ], {
        pageLineCapacity: 20,
        pageHeightPx: 68,
        paragraphGapPx: 0,
    });
    const frames = timed(result);
    const heading = frames.find((frame) => frame.lines?.[0]?.identity?.node_id === 'h1');
    const paragraph = frames.find((frame) => frame.lines?.[0]?.identity?.node_id === 'p1');

    assert.ok(heading);
    assert.ok(paragraph);
    assert.equal(heading.placement.virtual_page_index, 0);
    assert.equal(heading.placement.y_px, 0);
    assert.ok(BlockPolicy.blockRowHeightPx(heading, result, Layout) > result.options.lineHeightPx);
    assert.equal(paragraph.placement.virtual_page_index, 1);
    assert.equal(paragraph.placement.y_px, 0);
});

test('Block Moving keeps all blocks from the same visual row on the same reflowed y coordinate', () => {
    const result = buildMoving([
        node('p1', 0, '汉'.repeat(16), { start: 0 }),
    ], {
        widthPercent: 30,
        pageLineCapacity: 20,
        pageHeightPx: 200,
    });
    const frames = timed(result);
    const firstVisualRow = frames.filter((frame) => frame.placement.line_index === 0);

    assert.ok(firstVisualRow.length > 1, 'fixture must split the first visual row into multiple blocks');
    assert.equal(new Set(firstVisualRow.map((frame) => frame.placement.virtual_page_index)).size, 1);
    assert.equal(new Set(firstVisualRow.map((frame) => frame.placement.y_px)).size, 1);
});
