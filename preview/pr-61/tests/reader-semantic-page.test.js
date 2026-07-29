const test = require('node:test');
const assert = require('node:assert/strict');

const SemanticPage = require('../reader-semantic-page.js');

function fakeDocument() {
  function element(tag) {
    return {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      dataset: {},
      style: {},
      children: [],
      appendChild(child) { this.children.push(child); return child; },
    };
  }
  return { createElement: element };
}

test('normalizes valid spatial anchors and rejects invalid boxes', () => {
  assert.deepEqual(SemanticPage.normalizeBbox([0.1, 0.2, 0.8, 0.9]), [0.1, 0.2, 0.8, 0.9]);
  assert.equal(SemanticPage.normalizeBbox([0.8, 0.2, 0.1, 0.9]), null);
  assert.equal(SemanticPage.normalizeBbox([0.1, 0.2, 0.8]), null);
});

test('converts normalized boxes into percentage positioning', () => {
  assert.deepEqual(SemanticPage.spatialStyle([0.1, 0.2, 0.8, 0.9]), {
    left: '10%',
    top: '20%',
    width: '70%',
    minHeight: '70%',
  });
});

test('uses page dimensions when available and A-series fallback otherwise', () => {
  assert.equal(SemanticPage.pageAspectRatio({ width: 1200, height: 1600 }), 0.75);
  assert.equal(SemanticPage.pageAspectRatio({}), SemanticPage.DEFAULT_PAGE_ASPECT_RATIO);
});

test('keeps missing-anchor elements in same-page fallback flow', () => {
  const partitioned = SemanticPage.partitionElements([
    { element_id: 'a', normalized_bbox: [0, 0, 0.5, 0.5] },
    { element_id: 'b', normalized_bbox: null },
  ]);
  assert.deepEqual(partitioned.positioned.map((item) => item.element_id), ['a']);
  assert.deepEqual(partitioned.fallback.map((item) => item.element_id), ['b']);
});

test('renders positioned elements and fallback nodes without changing node identity', () => {
  const documentObject = fakeDocument();
  const page = {
    presentation_id: 'semantic-page:p1',
    source_unit_id: 'p1',
    source_order: 0,
    source_unit: { width: 1000, height: 1400 },
    elements: [
      { element_id: 'e1', node_id: 'n1', normalized_bbox: [0.1, 0.1, 0.8, 0.2], node: { node_id: 'n1', text: 'Heading' } },
      { element_id: 'e2', node_id: 'n2', normalized_bbox: null, node: { node_id: 'n2', text: 'Fallback' } },
    ],
  };

  const rendered = SemanticPage.renderSemanticPage({
    documentObject,
    page,
    renderNode(node) {
      const result = documentObject.createElement('article');
      result.dataset.readerNodeId = node.node_id;
      result.textContent = node.text;
      return result;
    },
  });

  assert.equal(rendered.dataset.sourceUnitId, 'p1');
  const canvas = rendered.children[1];
  assert.equal(canvas.children.length, 1);
  assert.equal(canvas.children[0].dataset.readerNodeId, 'n1');
  assert.equal(canvas.children[0].style.left, '10%');
  const fallback = rendered.children[2];
  assert.equal(fallback.dataset.fallbackCount, '1');
  assert.equal(fallback.children[0].dataset.readerNodeId, 'n2');
});
