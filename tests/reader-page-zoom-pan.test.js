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

function fakeElement(className = '') {
  const node = {
    className,
    children: [],
    dataset: {},
    style: {},
    parentNode: null,
    hidden: false,
    textContent: '',
  };
  const classes = () => new Set(String(node.className || '').split(/\s+/).filter(Boolean));
  node.classList = {
    contains(value) { return classes().has(value); },
    add(value) { const next = classes(); next.add(value); node.className = [...next].join(' '); },
    remove(value) { const next = classes(); next.delete(value); node.className = [...next].join(' '); },
  };
  node.matches = (selector) => selector.startsWith('.') && node.classList.contains(selector.slice(1));
  node.appendChild = (child) => {
    if (child.parentNode) {
      const index = child.parentNode.children.indexOf(child);
      if (index >= 0) child.parentNode.children.splice(index, 1);
    }
    node.children.push(child);
    child.parentNode = node;
    return child;
  };
  node.insertBefore = (child, reference) => {
    if (child.parentNode) {
      const oldIndex = child.parentNode.children.indexOf(child);
      if (oldIndex >= 0) child.parentNode.children.splice(oldIndex, 1);
    }
    const index = node.children.indexOf(reference);
    node.children.splice(index < 0 ? node.children.length : index, 0, child);
    child.parentNode = node;
    return child;
  };
  node.querySelector = (selector) => {
    for (const child of node.children) {
      if (child.matches?.(selector)) return child;
      const nested = child.querySelector?.(selector);
      if (nested) return nested;
    }
    return null;
  };
  node.setAttribute = () => {};
  return node;
}

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

test('all Reader pages are eligible and legacy-rendered content gets a fallback zoom surface', () => {
  assert.equal(ZoomPan.PAGE_SELECTOR, '.reader-v2-page');
  const page = fakeElement('reader-v2-page reader-v2-page-semantic_full_page');
  page.ownerDocument = { createElement: () => fakeElement() };
  const label = fakeElement('reader-v2-page-label');
  const legacyAsset = fakeElement('reader-v2-asset');
  page.appendChild(label);
  page.appendChild(legacyAsset);

  const surface = ZoomPan.surfaceForPage(page);
  assert.ok(surface);
  assert.equal(surface.className, 'reader-v2-page-zoom-surface');
  assert.equal(surface.dataset.readerZoomSurface, 'fallback');
  assert.equal(page.children[0], label);
  assert.equal(page.children[1], surface);
  assert.equal(surface.children[0], legacyAsset);
});

test('semantic shell remains the preferred zoom surface when available', () => {
  const page = fakeElement('reader-v2-page');
  const shell = fakeElement('reader-v2-semantic-page-shell');
  page.appendChild(shell);
  assert.equal(ZoomPan.surfaceForPage(page), shell);
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

test('zoom interaction CSS supports semantic and fallback surfaces plus grab states', () => {
  const css = fs.readFileSync('reader-page-zoom-pan.css', 'utf8');
  assert.match(css, /reader-v2-page--zoomed[^}]*cursor:\s*grab/s);
  assert.match(css, /reader-v2-page--zoom-dragging[^}]*cursor:\s*grabbing\s*!important/s);
  assert.match(css, /reader-v2-semantic-page-shell[^}]*transform-origin:\s*0 0/s);
  assert.match(css, /reader-v2-page-zoom-surface[^}]*transform-origin:\s*0 0/s);
  assert.match(css, /reader-v2-page-zoom-badge[^}]*position:\s*absolute/s);
});
