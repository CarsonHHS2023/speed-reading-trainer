const test = require('node:test');
const assert = require('node:assert/strict');

const Presentation = require('../reader-presentation.js');

function physicalUnits(count) {
  return Array.from({ length: count }, (_, index) => ({
    source_unit_id: `p${index + 1}`,
    source_order: index,
    kind: 'physical_page',
  }));
}

function pdfNode(id, order, pageNumber) {
  const sourceUnitId = `p${pageNumber}`;
  return {
    node_id: id,
    order,
    node_type: 'paragraph',
    text: `Page ${pageNumber}`,
    source_unit_ids: [sourceUnitId],
    location: {
      node_id: id,
      source_unit_id: sourceUnitId,
      source_anchor: {
        kind: 'spatial',
        source_unit_id: sourceUnitId,
        normalized_bbox: [0.1, 0.1, 0.9, 0.2],
      },
    },
  };
}

test('100-page PDF does not pre-render unloaded page shells beyond the first loaded node window', () => {
  const units = physicalUnits(100);
  const nodes = [pdfNode('first', 0, 1), pdfNode('tail', 149, 17)];

  const pages = Presentation.deriveSemanticFullPages(units, nodes);

  assert.equal(pages.length, 17);
  assert.deepEqual(pages.map((page) => page.source_unit_id), units.slice(0, 17).map((unit) => unit.source_unit_id));
  assert.equal(pages[0].nodes[0].node_id, 'first');
  assert.equal(pages.at(-1).nodes[0].node_id, 'tail');
  assert.equal(pages.some((page) => page.source_unit_id === 'p18'), false);
  assert.equal(pages.some((page) => page.source_unit_id === 'p100'), false);
});

test('PDF resume window renders only its covered physical-page range while retaining blank pages inside that range', () => {
  const units = physicalUnits(100);
  const nodes = [pdfNode('resume-start', 600, 50), pdfNode('resume-tail', 899, 60)];

  const pages = Presentation.deriveSemanticFullPages(units, nodes);

  assert.equal(pages.length, 11);
  assert.equal(pages[0].source_unit_id, 'p50');
  assert.equal(pages.at(-1).source_unit_id, 'p60');
  assert.equal(pages[1].source_unit_id, 'p51');
  assert.equal(pages[1].nodes.length, 0);
  assert.equal(pages.some((page) => page.source_unit_id === 'p49'), false);
  assert.equal(pages.some((page) => page.source_unit_id === 'p61'), false);
});

test('PDF with no loaded semantic nodes does not create a document-length run of empty page shells', () => {
  const units = physicalUnits(100);
  const presentation = Presentation.presentationForDocument({ source_units: units }, []);

  assert.equal(presentation.mode, 'semantic_full_page');
  assert.deepEqual(presentation.pages, []);
});

test('cross-page loaded fragment expands the bounded range through every referenced page', () => {
  const units = physicalUnits(100);
  const node = pdfNode('cross-page', 149, 17);
  node.source_unit_ids = ['p17', 'p18'];
  node.metadata = {
    page_fragments: [
      {
        source_unit_id: 'p17',
        text: 'end of page 17',
        source_anchor: { kind: 'spatial', source_unit_id: 'p17', normalized_bbox: [0.1, 0.8, 0.9, 0.95] },
      },
      {
        source_unit_id: 'p18',
        text: 'start of page 18',
        source_anchor: { kind: 'spatial', source_unit_id: 'p18', normalized_bbox: [0.1, 0.05, 0.9, 0.2] },
      },
    ],
  };

  const pages = Presentation.deriveSemanticFullPages(units, [node]);

  assert.deepEqual(pages.map((page) => page.source_unit_id), ['p17', 'p18']);
  assert.deepEqual(pages.map((page) => page.elements[0].display_text), ['end of page 17', 'start of page 18']);
});