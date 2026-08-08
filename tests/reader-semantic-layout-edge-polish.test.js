const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const EdgePolish = require('../reader-semantic-layout-edge-polish.js');

test('inline row clearance restores source geometry and inserts a minimum visual-text gap', () => {
  const adjusted = EdgePolish.computeInlineRowBboxes([
    [0.18, 0.40, 0.28, 0.48],
    [0.275, 0.405, 0.82, 0.47],
  ], 800, 8);

  assert.deepEqual(adjusted[0], [0.18, 0.40, 0.28, 0.48]);
  assert.ok(adjusted[1][0] >= 0.29 - 1e-12, 'right content starts at least 8px after the left visual');
  assert.equal(adjusted[1][2], 0.82, 'right edge is preserved while the left edge moves clear');
});

test('header clearance shifts content only when it intrudes into the header safety zone', () => {
  assert.equal(EdgePolish.headerShiftDelta(92, 96, 16), 12);
  assert.equal(EdgePolish.headerShiftDelta(92, 120, 16), 0);
});

test('preview bootstrap loads edge polish after refinement and before semantic integration', () => {
  const source = fs.readFileSync('reader-presentation.js', 'utf8');
  const refinementIndex = source.indexOf("'reader-semantic-layout-refinement.js'");
  const edgeIndex = source.indexOf("'reader-semantic-layout-edge-polish.js'");
  const edgeInstallIndex = source.indexOf('ReaderSemanticLayoutEdgePolishV2.install');
  const integrationIndex = source.indexOf("'reader-semantic-page-integration.js'");
  assert.ok(refinementIndex >= 0);
  assert.ok(edgeIndex > refinementIndex);
  assert.ok(edgeInstallIndex > edgeIndex);
  assert.ok(integrationIndex > edgeInstallIndex);
  assert.match(source, /reader-preview-head/);
});
