const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Policy = require('../speed-reading-speed-policy.js');

test('active measured width reserve scales with live font size', () => {
  assert.equal(Policy.measureReservePx({}), 48);
  assert.equal(Policy.measureReservePx({ fontSizePx: 28 }), 48);
  assert.equal(Policy.measureReservePx({ fontSizePx: 40 }), 60);
  assert.equal(Policy.measureReservePx({ fontSize: 50 }), 75);
});

test('measured width guard changes measurement input without becoming a second lineflow owner', () => {
  class Controller {
    adapterOptions() { return { maxWidthPx: 700, fontSizePx: 28, widthPercent: 100 }; }
    buildFrames() { return 'build'; }
    refreshFrames() { return 'refresh'; }
  }
  const originalBuild = Controller.prototype.buildFrames;
  const originalRefresh = Controller.prototype.refreshFrames;
  const responsive = {
    SINGLE_ROW_TYPES: new Set(['title', 'heading', 'list', 'list_item', 'toc', 'toc_item']),
  };

  assert.equal(Policy.installMeasuredWidthGuard(Controller.prototype, responsive), true);
  const controller = new Controller();
  const options = controller.adapterOptions();

  assert.equal(options.maxWidthPx, 652);
  assert.equal(options.measurementReservePx, 48);
  assert.equal(Controller.prototype.buildFrames, originalBuild);
  assert.equal(Controller.prototype.refreshFrames, originalRefresh);
  assert.equal(responsive.SINGLE_ROW_TYPES.has('list'), false);
  assert.equal(responsive.SINGLE_ROW_TYPES.has('list_item'), false);
  assert.equal(responsive.SINGLE_ROW_TYPES.has('title'), true);
  assert.equal(responsive.SINGLE_ROW_TYPES.has('toc'), true);
});

test('playback quote rows no longer draw the blue left rule', () => {
  const css = fs.readFileSync(require.resolve('../speed-reading-v2.css'), 'utf8');
  assert.match(css, /\.reader-playback-line-quote\s*\{[^}]*border-inline-start:\s*0/u);
  assert.doesNotMatch(css, /\.reader-playback-line-quote\s*\{[^}]*3px\s+solid/u);
});

test('canonical lifecycle keeps one lineflow owner and loads the active speed policy', () => {
  const source = fs.readFileSync(require.resolve('../reader-resume-lifecycle.js'), 'utf8');
  assert.match(source, /speed-reading-speed-policy\.js/u);
  assert.doesNotMatch(source, /reader-lineflow-polish\.js/u);
});
