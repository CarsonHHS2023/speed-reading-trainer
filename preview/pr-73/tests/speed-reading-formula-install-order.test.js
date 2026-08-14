const test = require('node:test');
const assert = require('node:assert/strict');

const FormulaRendering = require('../speed-reading-formula-rendering.js');

test('formula UI renderer waits until structured and responsive renderers are installed', () => {
  class Controller {}
  const root = { ReaderSpeedPlaybackUI: { ReaderSpeedPlaybackUIController: Controller } };

  assert.equal(FormulaRendering.rendererChainReady(root), false);
  Controller.prototype.__phase24cRendererInstalled = true;
  assert.equal(FormulaRendering.rendererChainReady(root), false);
  Controller.prototype.__responsiveLayoutInstalled = true;
  assert.equal(FormulaRendering.rendererChainReady(root), true);
});
