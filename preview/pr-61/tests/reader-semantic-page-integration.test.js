const test = require('node:test');
const assert = require('node:assert/strict');

const Integration = require('../reader-semantic-page-integration.js');

function fakeDocument() {
  return {
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        children: [],
        dataset: {},
        style: { setProperty() {} },
        appendChild(child) { this.children.push(child); return child; },
        className: '',
        textContent: '',
      };
    },
  };
}

test('semantic page integration identifies semantic full page state', () => {
  assert.equal(Integration.isSemanticFullPage({ kind: 'semantic_full_page' }, { mode: 'reflow' }), true);
  assert.equal(Integration.isSemanticFullPage({ kind: 'reflow_page' }, { mode: 'semantic_full_page' }), true);
  assert.equal(Integration.isSemanticFullPage({ kind: 'reflow_page' }, { mode: 'reflow' }), false);
});

test('classified cover page renders one full-page source asset without changing canonical node identity', () => {
  const carrier = {
    node_id: 'cover-title',
    node_type: 'heading',
    text: 'Book title',
    source_unit_ids: ['p1'],
    asset_refs: ['other-asset', 'cover-asset'],
    metadata: {
      page_kind: 'cover',
      presentation_mode: 'source_rendering',
      source_rendering_asset_id: 'cover-asset',
    },
  };
  const page = {
    presentation_id: 'semantic-page:p1',
    kind: 'semantic_full_page',
    source_order: 0,
    source_unit_id: 'p1',
    elements: [{ node_id: 'cover-title' }, { node_id: 'cover-author' }],
    nodes: [carrier, { node_id: 'cover-author', node_type: 'heading', text: 'Author' }],
  };

  const rendered = Integration.coverPageForSemanticPage(page);
  assert.equal(rendered.page_kind, 'cover');
  assert.equal(rendered.presentation_mode, 'source_rendering');
  assert.equal(rendered.elements.length, 1);
  assert.deepEqual(rendered.elements[0].normalized_bbox, [0, 0, 1, 1]);
  assert.equal(rendered.elements[0].node_id, 'cover-title');
  assert.equal(rendered.elements[0].node.node_id, 'cover-title');
  assert.equal(rendered.elements[0].node.node_type, 'figure');
  assert.deepEqual(rendered.elements[0].node.asset_refs, ['cover-asset']);
  assert.equal(page.elements.length, 2);
  assert.equal(carrier.node_type, 'heading');
});

test('ordinary semantic page remains unchanged without explicit cover metadata', () => {
  const page = {
    kind: 'semantic_full_page',
    nodes: [{ node_id: 'n1', node_type: 'figure', asset_refs: ['figure-asset'], metadata: {} }],
    elements: [{ node_id: 'n1' }],
  };
  assert.equal(Integration.coverPageForSemanticPage(page), page);
});

test('controller integration renders semantic pages through the semantic renderer', () => {
  const ReaderUI = require('../reader-ui-v2.js');
  Integration.installSemanticPageIntegration();

  const documentObject = fakeDocument();
  const container = documentObject.createElement('div');
  const controller = Object.create(ReaderUI.ReaderV2Controller.prototype);
  controller.document = documentObject;
  controller.presentationState = {
    mode: 'semantic_full_page',
    pages: [{
      presentation_id: 'semantic-page:p1',
      kind: 'semantic_full_page',
      source_order: 0,
      source_unit_id: 'p1',
      source_unit: { width: 1000, height: 1400 },
      elements: [],
      nodes: [],
    }],
  };
  controller.element = (id) => id === 'readerV2Pages' ? container : null;
  controller.clear = (target) => { target.children = []; };
  controller.renderNode = () => documentObject.createElement('article');

  controller.renderPages();

  assert.equal(container.children.length, 1);
  assert.match(container.children[0].className, /reader-v2-page-semantic_full_page/);
  assert.equal(container.children[0].dataset.presentationId, 'semantic-page:p1');
});