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

test('converts normalized boxes into bounded percentage positioning', () => {
  assert.deepEqual(SemanticPage.spatialStyle([0.1, 0.2, 0.8, 0.9]), {
    left: '10%',
    top: '20%',
    width: '70%',
    height: '70%',
  });
});

test('uses Reader API nested page dimensions and A-series fallback otherwise', () => {
  assert.equal(SemanticPage.pageAspectRatio({ dimensions: { width: 1200, height: 1600, unit: 'pixel' } }), 0.75);
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

test('removes provider debug fields while preserving surrounding body text', () => {
  const text = '一低点，中间不穿越任何价位的一条直线。\nlabel: text\nbbox: [152, 237, 882, 325]\ncontent:';
  assert.equal(
    SemanticPage.stripProviderDebugFields(text),
    '一低点，中间不穿越任何价位的一条直线。',
  );
  assert.equal(SemanticPage.stripProviderDebugFields('Table 1'), 'Table 1');
});

test('creates a temporary semantic display node only when debug text is removed', () => {
  const canonical = {
    node_id: 'n-debug',
    text: '正文。\nlabel: text\nbbox: [1, 2, 3, 4]\ncontent:',
  };
  const displayNode = SemanticPage.nodeForElement({ node_id: 'n-debug', node: canonical });
  assert.equal(displayNode.node_id, 'n-debug:semantic-display');
  assert.equal(displayNode.text, '正文。');
  assert.equal(displayNode.presentation_canonical_node_id, 'n-debug');
  assert.match(canonical.text, /label:/);
});

test('creates a temporary fragment render node while preserving canonical identity', () => {
  const canonical = { node_id: 'n1', text: 'Complete canonical paragraph' };
  const fragmentNode = SemanticPage.nodeForElement({
    node_id: 'n1',
    node: canonical,
    display_text: 'Page one fragment',
    fragment_index: 0,
  });
  assert.equal(fragmentNode.node_id, 'n1:page-fragment:0');
  assert.equal(fragmentNode.text, 'Page one fragment');
  assert.equal(fragmentNode.presentation_canonical_node_id, 'n1');
  assert.equal(canonical.node_id, 'n1');
  assert.equal(canonical.text, 'Complete canonical paragraph');
});

test('renders a page-height shell, positioned elements, and fallback nodes without changing identity', () => {
  const documentObject = fakeDocument();
  const page = {
    presentation_id: 'semantic-page:p1',
    source_unit_id: 'p1',
    source_order: 0,
    source_unit: { dimensions: { width: 1000, height: 1400, unit: 'pixel' } },
    elements: [
      {
        element_id: 'e1',
        node_id: 'n1',
        normalized_bbox: [0.1, 0.1, 0.8, 0.2],
        node: { node_id: 'n1', text: 'Complete canonical paragraph' },
        display_text: 'Page fragment',
        fragment_index: 0,
      },
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
  const shell = rendered.children[1];
  assert.equal(shell.className, 'reader-v2-semantic-page-shell');
  assert.equal(shell.style.aspectRatio, String(1000 / 1400));
  const canvas = shell.children[0];
  assert.equal(canvas.className, 'reader-v2-semantic-page-canvas');
  assert.equal(canvas.children.length, 1);
  assert.equal(canvas.children[0].dataset.readerNodeId, 'n1');
  assert.equal(canvas.children[0].style.left, '10%');
  assert.equal(canvas.children[0].style.height, '10%');
  const fragmentArticle = canvas.children[0].children[0];
  assert.equal(fragmentArticle.dataset.readerNodeId, 'n1');
  assert.equal(fragmentArticle.dataset.readerFragmentIndex, '0');
  assert.equal(fragmentArticle.textContent, 'Page fragment');
  const fallback = rendered.children[2];
  assert.equal(fallback.dataset.fallbackCount, '1');
  assert.equal(fallback.children[0].dataset.readerNodeId, 'n2');
});