const test = require('node:test');
const assert = require('node:assert/strict');

const Model = require('../reader-model.js');

test('mergePages preserves deterministic page order and replaces duplicate ids', () => {
  const merged = Model.mergePages(
    [{ page_id: 'p2', page_order: 2, nodes: [] }, { page_id: 'p1', page_order: 1, nodes: [] }],
    [{ page_id: 'p2', page_order: 2, nodes: [{ node_id: 'n2', order: 0 }] }, { page_id: 'p3', page_order: 3, nodes: [] }],
  );
  assert.deepEqual(merged.map((page) => page.page_id), ['p1', 'p2', 'p3']);
  assert.equal(merged[1].nodes.length, 1);
});

test('nodeTag maps heading levels without exceeding semantic bounds', () => {
  assert.equal(Model.nodeTag({ node_type: 'heading', heading_level: 1 }), 'h1');
  assert.equal(Model.nodeTag({ node_type: 'heading', heading_level: 9 }), 'h6');
  assert.equal(Model.nodeTag({ node_type: 'paragraph' }), 'p');
  assert.equal(Model.nodeTag({ node_type: 'caption' }), 'figcaption');
});

test('recovery summary uses explicit non-color-only messages', () => {
  const summary = Model.recoverySummary({
    processing_state: 'ready',
    content_state: 'degraded',
    warnings: [{ code: 'MISSING_ASSET_REFERENCE' }],
  });
  assert.equal(summary.label, '部分降级');
  assert.match(summary.messages.join(' '), /降级/);
  assert.match(summary.messages.join(' '), /MISSING_ASSET_REFERENCE/);
});

test('toPlainText only uses supported textual node content in deterministic order', () => {
  const text = Model.toPlainText([
    {
      page_id: 'p2',
      page_order: 2,
      nodes: [{ node_id: 'n3', node_type: 'paragraph', order: 0, text: 'third' }],
    },
    {
      page_id: 'p1',
      page_order: 1,
      nodes: [
        { node_id: 'n2', node_type: 'figure', order: 1, text: 'not canonical text' },
        { node_id: 'n1', node_type: 'heading', order: 0, text: 'first' },
      ],
    },
  ]);
  assert.equal(text, 'first\nthird');
});

test('locationKey is version and candidate bound', () => {
  const base = {
    contract_version: '1',
    document_ref: 'doc',
    candidate_id: 'candidate-a',
    candidate_schema_id: 'atlas.structured-content-candidate',
    candidate_schema_version: 1,
    page_id: 'p1',
    node_id: 'n1',
  };
  assert.notEqual(
    Model.locationKey(base),
    Model.locationKey({ ...base, candidate_id: 'candidate-b' }),
  );
});
