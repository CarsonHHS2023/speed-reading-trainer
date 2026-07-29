const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('marks source-rendered cover page and element for full-shell layout', () => {
  const documentObject = fakeDocument();
  const page = {
    presentation_id: 'semantic-page:cover',
    source_unit_id: 'pdf-page:000001',
    source_order: 0,
    source_unit: { dimensions: { width: 973, height: 1355, unit: 'pixel' } },
    page_kind: 'cover',
    presentation_mode: 'source_rendering',
    elements: [{
      element_id: 'cover:pdf-page:000001',
      kind: 'cover_source_rendering',
      node_id: 'cover-title',
      normalized_bbox: [0, 0, 1, 1],
      node: { node_id: 'cover-title', node_type: 'figure', asset_refs: ['cover-asset'] },
    }],
  };

  const rendered = SemanticPage.renderSemanticPage({
    documentObject,
    page,
    renderNode(node) {
      const result = documentObject.createElement('article');
      result.dataset.readerNodeId = node.node_id;
      return result;
    },
  });

  assert.match(rendered.className, /reader-v2-page--cover-source-rendering/);
  const shell = rendered.children[1];
  assert.match(shell.className, /reader-v2-semantic-page-shell--cover/);
  assert.equal(shell.style.aspectRatio, String(973 / 1355));
  const slot = shell.children[0].children[0];
  assert.match(slot.className, /reader-v2-semantic-page-element--cover-source-rendering/);
  assert.equal(slot.style.left, '0%');
  assert.equal(slot.style.top, '0%');
  assert.equal(slot.style.width, '100%');
  assert.equal(slot.style.height, '100%');
});

test('cover CSS removes ordinary node width constraints and fills the image', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'reader-semantic-page.css'), 'utf8');
  assert.match(css, /reader-v2-semantic-page-element--cover-source-rendering[^}]*max-width:\s*none/s);
  assert.match(css, /reader-v2-semantic-page-element--cover-source-rendering \.reader-v2-asset-image\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*fill;/s);
  assert.match(css, /reader-v2-semantic-page-element--cover-source-rendering \.reader-v2-asset-caption\s*\{[^}]*display:\s*none;/s);
});
