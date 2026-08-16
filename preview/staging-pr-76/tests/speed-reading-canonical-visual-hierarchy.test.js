const test = require('node:test');
const assert = require('node:assert/strict');

const Integrity = require('../speed-reading-layout-integrity.js');

const adapter = {
  resolvedTypeForNode(node) { return { type: node.node_type }; },
};

function spatialNode(id, type, page, bbox, order, extra = {}) {
  return {
    node_id: id,
    node_type: type,
    order,
    source_unit_ids: [page],
    source_anchors: [{ kind: 'spatial', source_unit_id: page, normalized_bbox: bbox }],
    location: {
      node_id: id,
      source_unit_id: page,
      source_anchor: { kind: 'spatial', source_unit_id: page, normalized_bbox: bbox },
    },
    ...extra,
  };
}

test('exact canonical caption parent remains the strongest evidence when it is not cross-page', () => {
  const nodes = [
    spatialNode('figure-1', 'figure', 'pdf-page:000001', [0.2, 0.2, 0.8, 0.7], 1, {
      child_refs: ['caption-1'],
    }),
    spatialNode('caption-1', 'caption', 'pdf-page:000001', [0.3, 0.72, 0.7, 0.76], 2, {
      parent_ref: 'figure-1', text: '图 1-1',
    }),
  ];

  const result = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.equal(result.byParent.get('figure-1')[0].association_mode, 'canonical_direct_visual_relation');
  assert.equal(result.consumedCaptionIds.has('caption-1'), true);
});

test('page-4 table caption uses same-page spatial evidence instead of unique-shared-parent forcing', () => {
  const nodes = [
    spatialNode('caption-table', 'caption', 'pdf-page:000004', [
      0.44851657940663175, 0.6256684491978609, 0.6114019778941245, 0.6421225832990539,
    ], 38, {
      parent_ref: 'group-table', text: '表1 复利的作用',
    }),
    spatialNode('table-1', 'table', 'pdf-page:000004', [
      0.16986620127981383, 0.6450020567667627, 0.8888888888888888, 0.8009049773755657,
    ], 39, {
      parent_ref: 'group-table', asset_refs: ['pdf-visual:table-1'],
    }),
  ];

  const result = Integrity.canonicalCaptionAssociations(adapter, nodes);
  const attached = result.byParent.get('table-1');
  assert.equal(attached.length, 1);
  assert.equal(attached[0].text, '表1 复利的作用');
  assert.equal(attached[0].association_mode, Integrity.CAPTION_VISUAL_POLICY);
  assert.equal(attached[0].association_metrics.shared_parent, true);
  assert.ok(attached[0].association_metrics.vertical_gap < 0.01);
});

test('page-7 GDP caption binds to the adjacent real figure and does not give a titleless visual the next caption', () => {
  const nodes = [
    spatialNode('titleless-figure', 'figure', 'pdf-page:000007', [0.34, 0.20, 0.66, 0.33], 62, {
      parent_ref: 'group-chart', asset_refs: ['pdf-visual:titleless'],
    }),
    spatialNode('actual-gdp-figure', 'figure', 'pdf-page:000007', [
      0.10945273631840796, 0.10123239436619719, 0.8893034825870647, 0.8072183098591549,
    ], 64, {
      parent_ref: 'group-chart', asset_refs: ['pdf-visual:gdp'],
    }),
    spatialNode('caption-gdp', 'caption', 'pdf-page:000007', [
      0.3756218905472637, 0.8820422535211268, 0.6623134328358209, 0.9119718309859155,
    ], 66, {
      parent_ref: 'group-chart', text: '图 1-1 印度 GDP 变化和国际黄金价格变化图',
    }),
  ];

  const result = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.equal(result.byParent.has('titleless-figure'), false, 'a visual without caption evidence must remain titleless');
  assert.equal(result.byParent.get('actual-gdp-figure')[0].node_id, 'caption-gdp');
  assert.equal(result.byParent.get('actual-gdp-figure')[0].association_mode, Integrity.CAPTION_VISUAL_POLICY);
});

test('shared parent is only an auxiliary hint and cannot beat a clearly better spatial match', () => {
  const nodes = [
    spatialNode('same-parent-but-worse', 'figure', 'pdf-page:000006', [0.10, 0.35, 0.50, 0.48], 30, {
      parent_ref: 'legacy-group',
    }),
    spatialNode('spatially-correct', 'figure', 'pdf-page:000006', [0.30, 0.545, 0.70, 0.75], 31, {
      parent_ref: 'different-group',
    }),
    spatialNode('caption', 'caption', 'pdf-page:000006', [0.40, 0.50, 0.60, 0.54], 32, {
      parent_ref: 'legacy-group', text: '空间上属于下方图的标题',
    }),
  ];

  const result = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.equal(result.byParent.has('same-parent-but-worse'), false);
  const attached = result.byParent.get('spatially-correct');
  assert.equal(attached.length, 1);
  assert.equal(attached[0].node_id, 'caption');
  assert.equal(attached[0].association_metrics.shared_parent, false);
});

test('a unique visual sharing the same parent is not enough when caption and visual are spatially far apart', () => {
  const nodes = [
    spatialNode('figure-far', 'figure', 'pdf-page:000003', [0.1, 0.05, 0.9, 0.25], 10, {
      parent_ref: 'same-group',
    }),
    spatialNode('caption-far', 'caption', 'pdf-page:000003', [0.2, 0.80, 0.8, 0.84], 11, {
      parent_ref: 'same-group', text: '后面的另一个标题',
    }),
  ];

  const result = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.equal(result.byParent.size, 0);
  assert.equal(result.consumedCaptionIds.has('caption-far'), false);
  assert.equal(result.unresolvedCaptionIds.has('caption-far'), true);
});

test('caption fallback never crosses physical pages even when coordinates and parent group look compatible', () => {
  const nodes = [
    spatialNode('figure-page-1', 'figure', 'pdf-page:000001', [0.2, 0.2, 0.8, 0.7], 1, {
      parent_ref: 'same-group',
    }),
    spatialNode('caption-page-2', 'caption', 'pdf-page:000002', [0.3, 0.71, 0.7, 0.75], 2, {
      parent_ref: 'same-group', text: '另一页标题',
    }),
  ];

  const result = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.equal(result.byParent.size, 0);
  assert.equal(result.unresolvedCaptionIds.has('caption-page-2'), true);
});

test('even a direct parent_ref is rejected when both Reader nodes explicitly identify different pages', () => {
  const nodes = [
    spatialNode('figure-page-1', 'figure', 'pdf-page:000001', [0.2, 0.2, 0.8, 0.7], 1),
    spatialNode('caption-page-2', 'caption', 'pdf-page:000002', [0.3, 0.71, 0.7, 0.75], 2, {
      parent_ref: 'figure-page-1', text: '错误跨页关系',
    }),
  ];

  const result = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.equal(result.byParent.size, 0);
  assert.equal(result.unresolvedCaptionIds.has('caption-page-2'), true);
});

test('spatially ambiguous same-page visuals stay unbound; Reader order does not break the ambiguity guard', () => {
  const nodes = [
    spatialNode('figure-a', 'figure', 'pdf-page:000005', [0.10, 0.30, 0.48, 0.60], 20, {
      parent_ref: 'group',
    }),
    spatialNode('figure-b', 'figure', 'pdf-page:000005', [0.52, 0.30, 0.90, 0.60], 21, {
      parent_ref: 'group',
    }),
    spatialNode('caption', 'caption', 'pdf-page:000005', [0.33, 0.61, 0.67, 0.65], 22, {
      parent_ref: 'group', text: '无法唯一判断的标题',
    }),
  ];

  const result = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.equal(result.byParent.size, 0);
  assert.equal(result.consumedCaptionIds.has('caption'), false);
  assert.equal(result.unresolvedCaptionIds.has('caption'), true);
});

test('source-rendered page carriers are not fallback caption targets', () => {
  const nodes = [
    spatialNode('page-carrier', 'figure', 'pdf-page:000007', [0, 0, 1, 1], 63, {
      parent_ref: 'group-chart',
      metadata: { presentation_mode: 'source_rendering', page_kind: 'full_page_chart' },
      asset_refs: ['pdf-source-rendering:page-7'],
    }),
    spatialNode('actual-chart', 'figure', 'pdf-page:000007', [0.12, 0.10, 0.88, 0.80], 64, {
      parent_ref: 'group-chart', asset_refs: ['pdf-visual:chart'],
    }),
    spatialNode('chart-caption', 'caption', 'pdf-page:000007', [0.35, 0.82, 0.65, 0.86], 66, {
      parent_ref: 'group-chart', text: '图标题',
    }),
  ];

  const result = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.equal(result.byParent.has('page-carrier'), false);
  assert.equal(result.byParent.get('actual-chart')[0].node_id, 'chart-caption');
});
