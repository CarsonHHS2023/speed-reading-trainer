const test = require('node:test');
const assert = require('node:assert/strict');

const Integrity = require('../speed-reading-layout-integrity.js');

const adapter = {
  resolvedTypeForNode(node) { return { type: node.node_type }; },
};

test('table caption binds to the unique table sibling under the same canonical semantic parent', () => {
  const nodes = [
    { node_id: 'group-table', node_type: 'paragraph', order: 37 },
    {
      node_id: 'caption-table', node_type: 'caption', parent_ref: 'group-table',
      text: '表1 复利的作用', order: 38,
    },
    {
      node_id: 'table-1', node_type: 'table', parent_ref: 'group-table',
      order: 39, asset_refs: ['pdf-visual:table-1'],
    },
  ];

  const result = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.deepEqual(result.byParent.get('table-1').map((item) => item.text), ['表1 复利的作用']);
  assert.equal(result.byParent.get('table-1')[0].association_mode, 'canonical_shared_parent_unique_visual');
  assert.equal(result.consumedCaptionIds.has('caption-table'), true);
  assert.equal(result.unresolvedCaptionIds.has('caption-table'), false);
});

test('caption on a visual container binds to its unique semantic visual child and suppresses the container frame', () => {
  const nodes = [
    {
      node_id: 'visual-container', node_type: 'figure', order: 63,
      asset_refs: ['provider-image:container'],
    },
    {
      node_id: 'actual-gdp-figure', node_type: 'figure', parent_ref: 'visual-container', order: 64,
      asset_refs: ['pdf-visual:gdp'],
    },
    {
      node_id: 'caption-gdp', node_type: 'caption', parent_ref: 'visual-container', order: 66,
      text: '图 1-1 印度 GDP 变化和国际黄金价格变化图',
    },
  ];

  const result = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.equal(result.byParent.has('visual-container'), false, 'container must not steal the caption');
  assert.deepEqual(result.byParent.get('actual-gdp-figure').map((item) => item.text), [
    '图 1-1 印度 GDP 变化和国际黄金价格变化图',
  ]);
  assert.equal(result.byParent.get('actual-gdp-figure')[0].association_mode, 'canonical_visual_parent_unique_child');
  assert.equal(result.suppressedVisualContainerIds.has('visual-container'), true);
  assert.equal(result.suppressedPlaybackNodeIds.has('visual-container'), true);
  assert.equal(result.suppressedPlaybackNodeIds.has('caption-gdp'), true);
});

test('a source-rendered page carrier cannot steal a caption from the unique semantic visual sibling', () => {
  const nodes = [
    { node_id: 'group-chart', node_type: 'paragraph', order: 62 },
    {
      node_id: 'page-carrier', node_type: 'figure', parent_ref: 'group-chart', order: 63,
      metadata: { presentation_mode: 'source_rendering', page_kind: 'full_page_chart' },
      asset_refs: ['pdf-source-rendering:page-7'],
    },
    {
      node_id: 'actual-chart', node_type: 'figure', parent_ref: 'group-chart', order: 64,
      asset_refs: ['pdf-visual:chart'],
    },
    {
      node_id: 'chart-caption', node_type: 'caption', parent_ref: 'group-chart', order: 66,
      text: '图 1-1 印度 GDP 变化和国际黄金价格变化图',
    },
  ];

  const result = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.equal(result.byParent.has('page-carrier'), false);
  assert.equal(result.byParent.get('actual-chart')[0].node_id, 'chart-caption');
  assert.equal(result.byParent.get('actual-chart')[0].association_mode, 'canonical_shared_parent_unique_visual');
});

test('ambiguous shared-parent visual groups stay unbound instead of using distance text or order guesses', () => {
  const nodes = [
    { node_id: 'group', node_type: 'paragraph', order: 1 },
    { node_id: 'figure-a', node_type: 'figure', parent_ref: 'group', order: 2 },
    { node_id: 'figure-b', node_type: 'figure', parent_ref: 'group', order: 3 },
    { node_id: 'caption', node_type: 'caption', parent_ref: 'group', text: '图标题', order: 4 },
  ];

  const result = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.equal(result.byParent.size, 0);
  assert.equal(result.consumedCaptionIds.has('caption'), false);
  assert.equal(result.unresolvedCaptionIds.has('caption'), true);
});
