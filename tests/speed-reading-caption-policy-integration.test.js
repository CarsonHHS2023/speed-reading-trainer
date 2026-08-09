const test = require('node:test');
const assert = require('node:assert/strict');

const StructurePolicy = require('../speed-reading-structure-policy.js');
const Integrity = require('../speed-reading-layout-integrity.js');

test('real structure policy classifies provider visual-title aliases for canonical caption binding', () => {
  const adapter = { resolvedTypeForNode: StructurePolicy.resolvedTypeForNode };
  const nodes = [
    {
      node_id: 'figure-1', node_type: 'unknown', order: 1,
      metadata: { provider_block_label: 'figure' },
    },
    {
      node_id: 'figure-title-1', node_type: 'unknown', order: 2, parent_ref: 'figure-1', text: '图 1-1 印度 GDP 变化图',
      metadata: { provider_block_label: 'figure_title' },
    },
    {
      node_id: 'table-1', node_type: 'unknown', order: 3,
      metadata: { provider_block_label: 'table' },
    },
    {
      node_id: 'table-title-1', node_type: 'unknown', order: 4, parent_ref: 'table-1', text: '表1 复利的作用',
      metadata: { provider_block_label: 'table_title' },
    },
  ];

  assert.equal(StructurePolicy.resolvedTypeForNode(nodes[1]).type, 'caption');
  assert.equal(StructurePolicy.resolvedTypeForNode(nodes[3]).type, 'caption');

  const associations = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.equal(associations.byParent.get('figure-1')[0].text, '图 1-1 印度 GDP 变化图');
  assert.equal(associations.byParent.get('table-1')[0].text, '表1 复利的作用');
  assert.deepEqual([...associations.consumedCaptionIds], ['figure-title-1', 'table-title-1']);
});

test('real structure policy keeps figure_caption and table_caption aliases canonical too', () => {
  const adapter = { resolvedTypeForNode: StructurePolicy.resolvedTypeForNode };
  const nodes = [
    { node_id: 'figure-1', node_type: 'figure', order: 1 },
    {
      node_id: 'figure-caption-1', node_type: 'unknown', order: 2, parent_ref: 'figure-1', text: '图注',
      metadata: { provider_block_label: 'figure_caption' },
    },
    { node_id: 'table-1', node_type: 'table', order: 3 },
    {
      node_id: 'table-caption-1', node_type: 'unknown', order: 4, parent_ref: 'table-1', text: '表注',
      metadata: { provider_block_label: 'table_caption' },
    },
  ];

  const associations = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.equal(associations.byParent.get('figure-1')[0].text, '图注');
  assert.equal(associations.byParent.get('table-1')[0].text, '表注');
});
