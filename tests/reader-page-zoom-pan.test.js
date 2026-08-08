const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ZoomPan = require('../reader-page-zoom-pan.js');

const dims = {
  viewportWidth: 800,
  viewportHeight: 600,
  contentWidth: 800,
  contentHeight: 600,
};

test('wheel zoom is bounded between 100% and 400%', () => {
  assert.equal(ZoomPan.clampScale(0.25), 1);
  assert.equal(ZoomPan.clampScale(8), 4);
  assert.ok(ZoomPan.scaleFromWheelDelta(1, -120) > 1);
  assert.ok(ZoomPan.scaleFromWheelDelta(2, 120) < 2);
  assert.equal(ZoomPan.scaleFromWheelDelta(4, -5000), 4);
  assert.equal(ZoomPan.scaleFromWheelDelta(1, 5000), 1);
});

test('zoom keeps the pointer-anchored content point stationary', () => {
  const next = ZoomPan.zoomStateAtPoint(
    { scale: 1, x: 0, y: 0 },
    2,
    { x: 400, y: 300 },
    dims,
  );
  assert.deepEqual(next, { scale: 2, x: -400, y: -300 });

  const beforeContentX = (400 - 0) / 1;
  const beforeContentY = (300 - 0) / 1;
  const afterContentX = (400 - next.x) / next.scale;
  const afterContentY = (300 - next.y) / next.scale;
  assert.equal(afterContentX, beforeContentX);
  assert.equal(afterContentY, beforeContentY);
});

test('pan is clamped so a zoomed page cannot be dragged completely out of view', () => {
  assert.deepEqual(
    ZoomPan.clampPan({ scale: 2, x: 500, y: 500 }, dims),
    { scale: 2, x: 0, y: 0 },
  );
  assert.deepEqual(
    ZoomPan.clampPan({ scale: 2, x: -5000, y: -5000 }, dims),
    { scale: 2, x: -800, y: -600 },
  );
});

test('returning to 100% resets pan to the canonical origin', () => {
  assert.deepEqual(
    ZoomPan.zoomStateAtPoint(
      { scale: 2, x: -300, y: -200 },
      1,
      { x: 250, y: 200 },
      dims,
    ),
    { scale: 1, x: 0, y: 0 },
  );
});

test('page zoom assets are loaded by the Reader page and included in syntax checks', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(html, /reader-page-zoom-pan\.css/);
  assert.match(html, /reader-page-zoom-pan\.js/);
  assert.ok(html.indexOf('reader-chapter-divider-source-rendering.js') < html.indexOf('reader-page-zoom-pan.js'));
  assert.ok(html.indexOf('reader-page-zoom-pan.js') < html.indexOf('app.js'));
  assert.match(packageJson.scripts.check, /node --check reader-page-zoom-pan\.js/);
});

test('zoom interaction CSS keeps the semantic page as viewport and exposes grab states', () => {
  const css = fs.readFileSync('reader-page-zoom-pan.css', 'utf8');
  assert.match(css, /reader-v2-page--zoomed[^}]*cursor:\s*grab/s);
  assert.match(css, /reader-v2-page--zoom-dragging[^}]*cursor:\s*grabbing\s*!important/s);
  assert.match(css, /reader-v2-semantic-page-shell[^}]*transform-origin:\s*0 0/s);
});
