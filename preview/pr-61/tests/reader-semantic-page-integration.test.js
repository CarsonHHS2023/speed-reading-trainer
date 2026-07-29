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
