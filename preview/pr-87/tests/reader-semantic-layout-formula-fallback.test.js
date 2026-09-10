const test = require('node:test');
const assert = require('node:assert/strict');

const Layout = require('../reader-semantic-layout-harmonizer.js');

const formulaElement = {
  normalized_bbox: [0.18, 0.40, 0.78, 0.52],
  node: { node_type: 'formula', asset_refs: ['formula-image'] },
};

test('KaTeX/readable formula wrappers stay in text flow', () => {
  const slot = {
    dataset: {},
    children: [{ dataset: { formulaRendering: 'katex' } }],
  };
  assert.equal(Layout.formulaUsesTextLayout(slot), true);
  assert.equal(Layout.runtimeTextFlow('formula', slot), true);
  assert.equal(Layout.runtimeFlowType('formula', slot), 'formula');
  assert.deepEqual(
    Layout.runtimeHorizontalBbox(formulaElement, slot, [0.1, 0.9]),
    [0.1, 0.40, 0.9, 0.52],
  );
});

test('asset-backed formula fallback remains a centered visual block', () => {
  const slot = {
    dataset: {},
    children: [{ dataset: {} }],
  };
  assert.equal(Layout.formulaUsesTextLayout(slot), false);
  assert.equal(Layout.runtimeTextFlow('formula', slot), false);
  assert.equal(Layout.runtimeFlowType('formula', slot), 'figure');
  const bbox = Layout.runtimeHorizontalBbox(formulaElement, slot, [0.1, 0.9]);
  assert.ok(Math.abs(bbox[0] - 0.20) < 1e-12);
  assert.ok(Math.abs(bbox[2] - 0.80) < 1e-12);
});
