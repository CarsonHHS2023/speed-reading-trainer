const test = require('node:test');
const assert = require('node:assert/strict');

const Debug = require('../reader-node-debug.js');
const Model = require('../reader-model.js');

function openResponse() {
    return {
        source_units: [
            { source_unit_id: 'page-1', kind: 'physical_page', source_order: 0, dimensions: { width: 600, height: 800 } },
            { source_unit_id: 'page-2', kind: 'physical_page', source_order: 1, dimensions: { width: 600, height: 800 } },
        ],
    };
}

function node(overrides = {}) {
    return {
        node_id: 'node-1',
        node_type: 'paragraph',
        order: 1,
        content_state: 'ready',
        source_unit_ids: ['page-1'],
        source_anchors: [{ kind: 'spatial', source_unit_id: 'page-1', normalized_bbox: [0.1, 0.2, 0.8, 0.3] }],
        text: '正文',
        heading_level: null,
        parent_ref: null,
        child_refs: [],
        asset_refs: [],
        warnings: [],
        metadata: {},
        ...overrides,
    };
}

test('recognizes both supported artifact suppression markers', () => {
    assert.equal(Debug.isSuppressedNode(node({ metadata: { suppressed_as_artifact: true } })), true);
    assert.equal(Debug.isSuppressedNode(node({ metadata: { suppressed_original_kind: 'paragraph' } })), true);
    assert.equal(Debug.isSuppressedNode(node()), false);
});

test('builds raw and frontend diagnostics without dropping suppressed nodes', () => {
    const raw = [
        node({ node_id: 'heading', node_type: 'heading', heading_level: 2, text: '一、趋势交易法流程' }),
        node({ node_id: 'bleed', order: 2, text: '背透文字', metadata: { suppressed_as_artifact: true, recovery_rule: 'show_through' } }),
    ];
    const presentation = {
        mode: 'semantic_full_page',
        pages: [{ presentation_id: 'page:p1', kind: 'semantic_full_page', source_unit_id: 'page-1', nodes: [raw[0]] }],
    };
    const records = Debug.buildDebugRecords(raw, openResponse(), presentation, { Model });

    assert.equal(records.length, 2);
    assert.equal(records[0].frontend_tag, 'h2');
    assert.equal(records[0].page.physical_page_number, 1);
    assert.equal(records[0].presentation.presentation_id, 'page:p1');
    assert.equal(records[1].suppressed, true);
    assert.equal(records[1].frontend_visible, false);
    assert.equal(records[1].recovery_rule, 'show_through');
});

test('filters by text, type, page, suppression, warning, and recovery rule', () => {
    const records = Debug.buildDebugRecords([
        node({ node_id: 'a', node_type: 'heading', heading_level: 2, text: '趋势交易法流程' }),
        node({ node_id: 'b', order: 2, text: '背透内容', warnings: [{ code: 'low_confidence' }], metadata: { suppressed_as_artifact: true, recovery_rule: 'show_through' } }),
        node({ node_id: 'c', order: 3, source_unit_ids: ['page-2'], source_anchors: [{ kind: 'spatial', source_unit_id: 'page-2', normalized_bbox: [0.1, 0.1, 0.5, 0.2] }], text: '第二页' }),
    ], openResponse(), { pages: [] }, { Model });

    assert.deepEqual(Debug.filterRecords(records, { query: '趋势' }).map((item) => item.node_id), ['a']);
    assert.deepEqual(Debug.filterRecords(records, { nodeType: 'heading' }).map((item) => item.node_id), ['a']);
    assert.deepEqual(Debug.filterRecords(records, { pageNumber: '2' }).map((item) => item.node_id), ['c']);
    assert.deepEqual(Debug.filterRecords(records, { suppression: 'suppressed' }).map((item) => item.node_id), ['b']);
    assert.deepEqual(Debug.filterRecords(records, { warningsOnly: true }).map((item) => item.node_id), ['b']);
    assert.deepEqual(Debug.filterRecords(records, { recoveryRule: 'show_through' }).map((item) => item.node_id), ['b']);
});

test('summary reports raw, visible, suppressed and type counts', () => {
    const records = Debug.buildDebugRecords([
        node({ node_id: 'a', node_type: 'heading' }),
        node({ node_id: 'b', metadata: { suppressed_as_artifact: true } }),
        node({ node_id: 'c', warnings: [{ code: 'w' }] }),
    ], openResponse(), { pages: [] }, { Model });
    const summary = Debug.summarizeRecords(records);

    assert.equal(summary.raw_node_count, 3);
    assert.equal(summary.frontend_visible_count, 2);
    assert.equal(summary.suppressed_count, 1);
    assert.equal(summary.warning_node_count, 1);
    assert.equal(summary.types.heading, 1);
    assert.equal(summary.types.paragraph, 2);
});
