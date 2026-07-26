const test = require('node:test');
const assert = require('node:assert/strict');

const Presentation = require('../reader-presentation.js');
const Model = require('../reader-model.js');

function location(nodeId, sourceUnitId, anchor) {
  return {
    contract_version: '2',
    document_ref: 'doc',
    candidate_id: 'candidate',
    candidate_schema_id: 'atlas.structured-content',
    candidate_schema_version: 2,
    node_id: nodeId,
    source_unit_id: sourceUnitId,
    source_anchor: anchor,
  };
}

function node(id, order, sourceUnitId, text, type = 'paragraph') {
  return {
    node_id: id,
    order,
    node_type: type,
    text,
    source_unit_ids: [sourceUnitId],
    location: location(id, sourceUnitId, { kind: 'text_span', source_unit_id: sourceUnitId, start: 0, end: text.length }),
  };
}

test('PDF presentation preserves physical source-unit page boundaries', () => {
  const units = [
    { source_unit_id: 'p2', source_order: 1, kind: 'physical_page' },
    { source_unit_id: 'p1', source_order: 0, kind: 'physical_page' },
  ];
  const nodes = [
    { ...node('n2', 1, 'p2', 'Second'), location: location('n2', 'p2', { kind: 'spatial', source_unit_id: 'p2', normalized_bbox: [0, 0, 1, 1] }) },
    { ...node('n1', 0, 'p1', 'First'), location: location('n1', 'p1', { kind: 'spatial', source_unit_id: 'p1', normalized_bbox: [0, 0, 1, 1] }) },
  ];

  const pages = Presentation.derivePhysicalPages(units, nodes);
  assert.deepEqual(pages.map((page) => page.source_unit_id), ['p1', 'p2']);
  assert.deepEqual(pages.map((page) => page.nodes.map((item) => item.node_id)), [['n1'], ['n2']]);
  assert.equal(pages[0].presentation_id, 'physical:p1');
  assert.equal('page_id' in pages[0], false);
});

test('TXT reflow changes presentation grouping without changing node or location identity', () => {
  const nodes = [
    node('h1', 0, 'f1', 'Heading', 'heading'),
    node('n1', 1, 'f1', 'A'.repeat(100)),
    node('n2', 2, 'f2', 'B'.repeat(100)),
  ];
  const beforeKeys = nodes.map((item) => Model.locationKey(item.location));

  const wide = Presentation.deriveReflowPages(nodes, { lineWidth: 50, maxLines: 20, fontSize: 20, viewportWidth: 900 });
  const narrow = Presentation.deriveReflowPages(nodes, { lineWidth: 20, maxLines: 6, fontSize: 36, viewportWidth: 420 });

  assert.ok(wide.length < narrow.length);
  assert.deepEqual(nodes.map((item) => Model.locationKey(item.location)), beforeKeys);
  assert.deepEqual([...new Set(narrow.flatMap((page) => page.nodes.map((item) => item.node_id)))], ['h1', 'n1', 'n2']);
  assert.equal(narrow.flatMap((page) => page.nodes).length, 3);
});

test('presentation mode is derived from source-unit kinds', () => {
  const pdf = Presentation.presentationForDocument(
    { source_units: [{ source_unit_id: 'p1', source_order: 0, kind: 'physical_page' }] },
    [{ ...node('n1', 0, 'p1', 'PDF'), location: location('n1', 'p1', { kind: 'spatial', source_unit_id: 'p1', normalized_bbox: [0, 0, 1, 1] }) }],
  );
  assert.equal(pdf.mode, 'physical');

  const txt = Presentation.presentationForDocument(
    { source_units: [{ source_unit_id: 'f1', source_order: 0, kind: 'text_flow' }] },
    [node('n1', 0, 'f1', 'TXT')],
  );
  assert.equal(txt.mode, 'reflow');
});
