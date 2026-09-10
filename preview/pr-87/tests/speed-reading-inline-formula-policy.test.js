const test = require('node:test');
const assert = require('node:assert/strict');
const BaseAdapter = require('../speed-reading-adapter.js');
const Policy = require('../speed-reading-structure-policy.js');

const documentView = {
  contract_version: '2',
  document_ref: 'doc-formula',
  candidate_id: 'cand-formula',
  candidate_schema_id: 'atlas.structured-content-v2',
  candidate_schema_version: 2,
  source_units: [{ source_unit_id: 'p1', source_order: 0, kind: 'physical_page' }],
};

function node(id, order, providerLabel, text) {
  return {
    node_id: id,
    order,
    node_type: 'formula',
    text,
    metadata: { provider_block_label: providerLabel },
    source_unit_ids: ['p1'],
    location: {
      node_id: id,
      source_unit_id: 'p1',
      source_anchor: { kind: 'spatial', source_unit_id: 'p1', normalized_bbox: [0.1, 0.1, 0.9, 0.2] },
    },
  };
}

test('inline formula metadata keeps the formula in timed text flow while display formula remains manual', () => {
  const prepared = Policy.prepareStructuredNodes([
    node('inline', 0, 'inline_formula', 'x + y'),
    node('display', 1, 'display_formula', 'E = mc^2'),
  ]);
  assert.deepEqual(prepared.map((item) => item.node_type), ['paragraph', 'formula']);
  assert.deepEqual(prepared.map((item) => item.raw_node_type), ['inline_formula', 'display_formula']);

  // Validate the policy output at the adapter boundary without depending on the
  // process-global idempotent installation flag used by runtime enhancement loading.
  const elements = BaseAdapter.buildReadingElements(documentView, prepared);
  assert.deepEqual(elements.map((item) => item.kind), ['text', 'manual']);
  assert.deepEqual(elements.map((item) => item.node_type), ['paragraph', 'formula']);
});
