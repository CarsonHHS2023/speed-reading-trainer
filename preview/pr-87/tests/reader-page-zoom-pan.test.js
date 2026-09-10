const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ZoomPan = require('../reader-page-zoom-pan.js');

const dims = {
  viewportWidth: 1200,
  viewportHeight: 800,
  pageWidth: 900,
  pageHeight: 1000,
  baseLeft: 150,
  baseTop: 100,
};

test('wheel zoom is bounded between 50% and 400%', () => {
  assert.equal(ZoomPan.clampScale(0.25), 0.5);
  assert.equal(ZoomPan.clampScale(8), 4);
  assert.ok(ZoomPan.scaleFromWheelDelta(1, -120) > 1);
  assert.ok(ZoomPan.scaleFromWheelDelta(1, 120) < 1);
  assert.equal(ZoomPan.scaleFromWheelDelta(4, -5000), 4);
  assert.equal(ZoomPan.scaleFromWheelDelta(0.5, 5000), 0.5);
});

test('toolbar zoom indicator always exposes the current percentage', () => {
  assert.equal(ZoomPan.formatScalePercent(0.5), '50%');
  assert.equal(ZoomPan.formatScalePercent(1), '100%');
  assert.equal(ZoomPan.formatScalePercent(1.234), '123%');
  assert.equal(ZoomPan.formatScalePercent(4), '400%');
  assert.equal(ZoomPan.RAIL_SELECTOR, '#readerStudyToolsRail');
  assert.equal(ZoomPan.INDICATOR_CLASS, 'reader-page-zoom-indicator');
});

test('study toolbar is excluded from the effective zoom viewport', () => {
  const viewport = {
    left: 100,
    top: 0,
    right: 1100,
    bottom: 800,
    width: 1000,
    height: 800,
  };
  const rail = {
    left: 1054,
    top: 0,
    right: 1100,
    bottom: 800,
    width: 46,
    height: 800,
  };
  assert.deepEqual(
    ZoomPan.clipViewportRect(viewport, rail),
    {
      left: 100,
      top: 0,
      right: 1054,
      bottom: 800,
      width: 954,
      height: 800,
    },
  );
  assert.equal(ZoomPan.clipViewportRect(viewport, null).width, 1000);
});

test('zoomed-out whole page is centered in the Reader main viewport', () => {
  assert.deepEqual(
    ZoomPan.clampPan({ scale: 0.5, x: 0, y: 0 }, dims),
    { scale: 0.5, x: 225, y: 0 },
  );
  assert.equal(ZoomPan.shrinkLayoutOffset(1000, 0.5), -500);
  assert.equal(ZoomPan.shrinkLayoutOffset(1000, 1), 0);
  assert.equal(ZoomPan.shrinkLayoutOffset(1000, 2), 0);
});

test('zoom keeps the pointer-anchored content point stationary when enlarging', () => {
  const next = ZoomPan.zoomStateAtPoint(
    { scale: 1, x: 0, y: 0 },
    2,
    { x: 400, y: 300 },
    dims,
  );
  assert.deepEqual(next, { scale: 2, x: -250, y: -200 });

  const beforeContentX = (400 - dims.baseLeft) / 1;
  const beforeContentY = (300 - dims.baseTop) / 1;
  const afterContentX = (400 - dims.baseLeft - next.x) / next.scale;
  const afterContentY = (300 - dims.baseTop - next.y) / next.scale;
  assert.equal(afterContentX, beforeContentX);
  assert.equal(afterContentY, beforeContentY);
});

test('enlarged page pans against the available Reader viewport rather than its own page frame', () => {
  assert.deepEqual(
    ZoomPan.panBounds(2, dims),
    { minX: -750, maxX: 0, minY: -1300, maxY: 0 },
  );
  assert.deepEqual(
    ZoomPan.clampPan({ scale: 2, x: 500, y: 500 }, dims),
    { scale: 2, x: 0, y: 0 },
  );
  assert.deepEqual(
    ZoomPan.clampPan({ scale: 2, x: -5000, y: -5000 }, dims),
    { scale: 2, x: -750, y: -1300 },
  );
});

test('returning to 100% restores the canonical page frame and position', () => {
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

test('all Reader page frames are eligible and Reader main remains the base viewport', () => {
  assert.equal(ZoomPan.PAGE_SELECTOR, '.reader-v2-page');
  assert.equal(ZoomPan.VIEWPORT_SELECTOR, '.reader-v2-main');
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

test('zoom CSS reserves the study rail, keeps zoomed pages below toolbars, and mounts percentage in the rail', () => {
  const css = fs.readFileSync('reader-page-zoom-pan.css', 'utf8');
  assert.match(css, /\.reader-v2-main\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /#readerV2Display \.reader-v2-main\s*\{[^}]*margin-inline-end:\s*var\(--study-tools-rail-width/s);
  assert.match(css, /data-study-tools-expanded="1"[^}]*reader-v2-main[^}]*margin-inline-end:\s*calc/s);
  assert.match(css, /\.reader-v2-page\s*\{[^}]*transform-origin:\s*0 0/s);
  assert.match(css, /reader-v2-page--zoomed-in[^}]*z-index:\s*15/s);
  assert.match(css, /reader-v2-page--zoomed-in[^}]*cursor:\s*grab/s);
  assert.match(css, /reader-v2-page--zoom-dragging[^}]*cursor:\s*grabbing\s*!important/s);
  assert.match(css, /reader-page-zoom-indicator[^}]*position:\s*absolute/s);
  assert.match(css, /reader-page-zoom-indicator[^}]*top:\s*14px/s);
});
