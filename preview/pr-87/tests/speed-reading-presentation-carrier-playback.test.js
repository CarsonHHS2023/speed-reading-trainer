const test = require('node:test');
const assert = require('node:assert/strict');
const BaseAdapter = require('../speed-reading-adapter.js');
const Policy = require('../speed-reading-structure-policy.js');

const documentView = {
  contract_version: '2',
  document_ref: 'doc-divider',
  candidate_id: 'cand-divider',
  candidate_schema_id: 'atlas.structured-content-v2',
  candidate_schema_version: 2,
  source_units: [{ source_unit_id: 'pdf-page:000008', source_order: 7, kind: 'physical_page' }],
};

test('source-rendered chapter divider survives structure policy and becomes a manual visual frame', () => {
  const divider = {
    node_id: 'divider-8',
    order: 83,
    node_type: 'figure',
    text: null,
    source_unit_ids: ['pdf-page:000008'],
    location: {
      node_id: 'divider-8',
      source_unit_id: 'pdf-page:000008',
      source_anchor: {
        kind: 'spatial',
        source_unit_id: 'pdf-page:000008',
        normalized_bbox: [0, 0, 1, 1],
      },
    },
    asset_refs: ['pdf-source-rendering:chapter-divider'],
    metadata: {
      page_kind: 'chapter_divider',
      presentation_mode: 'source_rendering',
      spr_node_kind: 'figure',
    },
  };

  const prepared = Policy.prepareStructuredNodes([divider]);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].node_id, 'divider-8');
  assert.deepEqual(prepared[0].asset_refs, ['pdf-source-rendering:chapter-divider']);

  const elements = BaseAdapter.buildReadingElements(documentView, prepared);
  assert.equal(elements.length, 1);
  assert.equal(elements[0].kind, 'manual');
  assert.equal(elements[0].node_type, 'figure');
  assert.deepEqual(elements[0].asset_refs, ['pdf-source-rendering:chapter-divider']);
});
