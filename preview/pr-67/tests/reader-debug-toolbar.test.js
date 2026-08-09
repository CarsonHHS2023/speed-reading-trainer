const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const DebugToolbar = require('../reader-debug-toolbar.js');

test('debug URL carries current document, candidate, and physical page', () => {
  const controller = {
    reader: {
      documentRef: 'doc 1',
      candidateId: 'candidate-1',
      lastLocation: { source_unit_id: 'pdf-page:000005' },
    },
    playback: { snapshot: () => ({ state: 'idle', frame: null }) },
  };
  assert.equal(
    DebugToolbar.buildDebugUrl(controller),
    'reader-node-debug.html?document_ref=doc+1&candidate_id=candidate-1&source_unit_id=pdf-page%3A000005',
  );
});

test('active playback frame page takes precedence over the Reader last location', () => {
  const controller = {
    reader: {
      documentRef: 'doc-1',
      candidateId: 'candidate-1',
      lastLocation: { source_unit_id: 'pdf-page:000004' },
    },
    playback: {
      snapshot: () => ({
        state: 'playing',
        frame: { identity: { source_unit_id: 'pdf-page:000009' } },
      }),
    },
  };
  assert.match(DebugToolbar.buildDebugUrl(controller), /source_unit_id=pdf-page%3A000009/);
});

test('stopped or idle playback ignores its retained frame and uses Reader location', () => {
  for (const state of ['idle', 'stopped', 'completed']) {
    const controller = {
      reader: {
        documentRef: 'doc-1',
        candidateId: 'candidate-1',
        lastLocation: { source_unit_id: 'pdf-page:000009' },
      },
      playback: {
        snapshot: () => ({
          state,
          frame: { identity: { source_unit_id: 'pdf-page:000001' } },
        }),
      },
    };
    assert.match(
      DebugToolbar.buildDebugUrl(controller),
      /source_unit_id=pdf-page%3A000009/,
      `expected ${state} playback to use the Reader location`,
    );
  }
});

test('paused and manual playback frames remain active debug locations', () => {
  for (const state of ['paused', 'manual']) {
    const controller = {
      reader: {
        documentRef: 'doc-1',
        candidateId: 'candidate-1',
        lastLocation: { source_unit_id: 'pdf-page:000004' },
      },
      playback: {
        snapshot: () => ({
          state,
          frame: { identity: { source_unit_id: 'pdf-page:000008' } },
        }),
      },
    };
    assert.match(
      DebugToolbar.buildDebugUrl(controller),
      /source_unit_id=pdf-page%3A000008/,
      `expected ${state} playback to use its current frame`,
    );
  }
});

test('debug URL is unavailable until a Reader candidate is open', () => {
  assert.equal(DebugToolbar.buildDebugUrl({ reader: { documentRef: 'doc-1' } }), null);
});

function fakeElement(id = '', classes = []) {
  const classSet = new Set(classes);
  const listeners = new Map();
  const element = {
    id,
    className: classes.join(' '),
    children: [],
    parentNode: null,
    hidden: false,
    title: '',
    dataset: {},
    attributes: {},
    classList: {
      add(...names) { names.forEach((name) => classSet.add(name)); },
      contains(name) { return classSet.has(name) || String(element.className || '').split(/\s+/).includes(name); },
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(type, handler) { listeners.set(type, handler); },
    dispatch(type, event = {}) { listeners.get(type)?.(event); },
    appendChild(child) {
      if (child.parentNode) {
        const index = child.parentNode.children.indexOf(child);
        if (index >= 0) child.parentNode.children.splice(index, 1);
      }
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    querySelector(selector) {
      if (!selector.startsWith('.')) return null;
      const className = selector.slice(1);
      return this.children.find((child) => child.classList?.contains(className)) || null;
    },
    replaceWith(next) {
      const parent = this.parentNode;
      if (!parent) return;
      const index = parent.children.indexOf(this);
      if (index >= 0) parent.children.splice(index, 1, next);
      next.parentNode = parent;
      this.parentNode = null;
    },
  };
  return element;
}

test('playback controls merge beside Book List and the old top toolbar disappears', () => {
  const header = fakeElement('', ['booklist-header']);
  const rail = fakeElement('readerStudyToolsRail', ['reader-study-tools-rail']);
  const tabs = fakeElement('', ['reader-study-tools-tabs']);
  rail.appendChild(tabs);
  const readingPanel = fakeElement('', ['reading-panel']);
  const toolbar = fakeElement('speedReadingV2Toolbar', ['speed-reading-v2-toolbar']);
  readingPanel.appendChild(toolbar);
  const toggle = fakeElement('readingToggleBtn', ['reading-toggle-btn']);
  header.appendChild(toggle);
  const prev = fakeElement('speedReadingPrev');
  const pause = fakeElement('speedReadingPause');
  const next = fakeElement('speedReadingNext');
  const stop = fakeElement('speedReadingStop');
  const debug = fakeElement('speedReadingDebug');
  for (const child of [prev, pause, next, stop, debug]) toolbar.appendChild(child);

  const byId = new Map([
    ['speedReadingV2Toolbar', toolbar], ['readingToggleBtn', toggle],
    ['speedReadingPrev', prev], ['speedReadingPause', pause], ['speedReadingNext', next],
    ['speedReadingStop', stop], ['speedReadingDebug', debug],
  ]);
  const documentObject = {
    getElementById(id) { return byId.get(id) || null; },
    querySelector(selector) {
      if (selector === '.booklist-header') return header;
      if (selector === '#readerStudyToolsRail') return rail;
      return null;
    },
    createElement() { return fakeElement(); },
  };
  rail.querySelector = (selector) => selector === '.reader-study-tools-tabs' ? tabs : null;

  assert.equal(DebugToolbar.relocateReaderControls({ document: documentObject }), true);
  const group = header.querySelector('.reader-booklist-playback-controls');
  assert.ok(group);
  assert.deepEqual(group.children.map((child) => child.id), [
    'speedReadingPrev', 'speedReadingPause', 'speedReadingNext', 'readingToggleBtn',
  ]);
  assert.equal(tabs.children.includes(debug), true);
  assert.equal(debug.classList.contains('reader-study-tool-tab'), true);
  assert.equal(readingPanel.children.length, 1);
  assert.equal(readingPanel.children[0].id, 'speedReadingV2Toolbar');
  assert.equal(readingPanel.children[0].hidden, true);
  assert.equal(readingPanel.children[0].className, 'speed-reading-v2-toolbar-compat');
  assert.equal(stop.parentNode, toolbar);
  assert.equal(toolbar.parentNode, null);
});

test('zoom percentage tooltip and click reset every rendered page to canonical 100%', () => {
  const indicator = fakeElement('', ['reader-page-zoom-indicator']);
  const rail = fakeElement('readerStudyToolsRail');
  rail.querySelector = (selector) => selector === '.reader-page-zoom-indicator' ? indicator : null;
  const pages = [fakeElement('p1'), fakeElement('p2'), fakeElement('p3')];
  const calls = [];
  let indicatorScale = null;
  const root = {
    document: {
      querySelector(selector) { return selector === '#readerStudyToolsRail' ? rail : null; },
      querySelectorAll(selector) { return selector === '.reader-v2-page' ? pages : []; },
    },
    ReaderPageZoomPanV2: {
      initialState: () => ({ scale: 1, x: 0, y: 0 }),
      applyState(page, state) { calls.push([page.id, state]); },
      updateZoomIndicator(_document, scale) { indicatorScale = scale; },
    },
  };

  assert.equal(DebugToolbar.configureZoomResetIndicator(root), true);
  assert.equal(indicator.title, '恢复到100%');
  assert.equal(indicator.attributes['aria-label'], '恢复到100%');
  assert.equal(indicator.attributes.role, 'button');
  assert.equal(indicator.attributes.tabindex, '0');
  indicator.dispatch('click');
  assert.deepEqual(calls.map(([id]) => id), ['p1', 'p2', 'p3']);
  assert.ok(calls.every(([, state]) => state.scale === 1 && state.x === 0 && state.y === 0));
  assert.equal(indicatorScale, 1);
});

test('toolbar layout constants preserve the existing playback state-machine controls', () => {
  assert.deepEqual(DebugToolbar.MOVED_PLAYBACK_CONTROL_IDS, [
    'speedReadingPrev', 'speedReadingPause', 'speedReadingNext',
  ]);
  assert.equal(DebugToolbar.READING_TOGGLE_ID, 'readingToggleBtn');
  assert.equal(DebugToolbar.BUTTON_ID, 'speedReadingDebug');
  assert.equal(DebugToolbar.ZOOM_RESET_TITLE, '恢复到100%');
});

test('main page loads debug toolbar after playback toolbar creation', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /reader-debug-toolbar\.js/);
  assert.ok(html.indexOf('reader-speed-playback-ui.js') < html.indexOf('reader-debug-toolbar.js'));
});

test('layout CSS makes zoom percentage clickable, merges controls compactly, and hides compatibility anchor', () => {
  const css = fs.readFileSync('reader-page-zoom-pan.css', 'utf8');
  assert.match(css, /reader-page-zoom-indicator[^}]*pointer-events:\s*auto/s);
  assert.match(css, /reader-page-zoom-indicator[^}]*cursor:\s*pointer/s);
  assert.match(css, /reader-booklist-playback-controls[^}]*display:\s*flex/s);
  assert.match(css, /reader-booklist-playback-controls button[^}]*width:\s*28px/s);
  assert.match(css, /speed-reading-v2-toolbar-compat[^}]*display:\s*none\s*!important/s);
});
