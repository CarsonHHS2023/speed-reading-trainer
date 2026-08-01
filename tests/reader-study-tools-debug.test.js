const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Rail = require('../reader-study-tools-rail.js');

test('debug context prefers the active playback frame identity', () => {
  const context = Rail.resolveDebugContext({
    reader: {
      documentRef: 'reader-document',
      candidateId: 'reader-candidate',
      lastLocation: { source_unit_id: 'pdf-page:reader' },
    },
    playback: {
      currentFrame() {
        return {
          identity: {
            document_ref: 'frame-document',
            candidate_id: 'frame-candidate',
            source_unit_ids: ['pdf-page:000005'],
          },
        };
      },
    },
  });

  assert.deepEqual(context, {
    documentRef: 'frame-document',
    candidateId: 'frame-candidate',
    sourceUnitId: 'pdf-page:000005',
  });
});

test('debug context falls back to the most visible semantic page', () => {
  const viewport = {
    getBoundingClientRect() { return { top: 0, bottom: 100 }; },
  };
  const pages = [
    {
      dataset: { sourceUnitId: 'pdf-page:000001' },
      getBoundingClientRect() { return { top: -50, bottom: 20 }; },
    },
    {
      dataset: { sourceUnitId: 'pdf-page:000002' },
      getBoundingClientRect() { return { top: 20, bottom: 90 }; },
    },
  ];
  const documentObject = {
    querySelector(selector) {
      return selector === '.reader-v2-main' ? viewport : null;
    },
    querySelectorAll(selector) {
      return selector === '.reader-v2-page[data-source-unit-id]' ? pages : [];
    },
  };

  assert.equal(Rail.visibleSourceUnitId(documentObject), 'pdf-page:000002');
  assert.deepEqual(Rail.resolveDebugContext({
    reader: { documentRef: 'doc-2', candidateId: 'candidate-2' },
    documentObject,
  }), {
    documentRef: 'doc-2',
    candidateId: 'candidate-2',
    sourceUnitId: 'pdf-page:000002',
  });
});

test('debug page URL preserves Reader identity query parameters', () => {
  const href = Rail.buildDebugPageUrl({
    documentRef: '804d2f87-5234-47e1-b39d-eec163a06edf',
    candidateId: 'scv2_pdf_dc44a675ce65a7ae05ab8f6d',
    sourceUnitId: 'pdf-page:000005',
  }, 'https://example.test/reader/index.html');
  const url = new URL(href);

  assert.equal(url.origin, 'https://example.test');
  assert.equal(url.pathname, '/reader/reader-node-debug.html');
  assert.equal(url.searchParams.get('document_ref'), '804d2f87-5234-47e1-b39d-eec163a06edf');
  assert.equal(url.searchParams.get('candidate_id'), 'scv2_pdf_dc44a675ce65a7ae05ab8f6d');
  assert.equal(url.searchParams.get('source_unit_id'), 'pdf-page:000005');
});

test('debug action opens a protected new tab with the current Reader context', () => {
  const calls = [];
  const openedWindow = { opener: 'existing' };
  const reader = {
    documentRef: 'doc-open',
    candidateId: 'candidate-open',
    lastLocation: { source_unit_id: 'pdf-page:000009' },
  };
  const windowObject = {
    location: { href: 'https://example.test/app/index.html' },
    ReaderSpeedPlaybackUI: {
      getDefaultController() { return { reader, playback: null }; },
    },
    open(...args) {
      calls.push(args);
      return openedWindow;
    },
  };
  const documentObject = {
    defaultView: windowObject,
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const controller = new Rail.StudyToolsRailController({ documentObject, windowObject });
  const href = controller.openDebugPage();

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(1), ['_blank', 'noopener,noreferrer']);
  assert.equal(calls[0][0], href);
  assert.equal(new URL(href).searchParams.get('source_unit_id'), 'pdf-page:000009');
  assert.equal(openedWindow.opener, null);
});

test('right-side rail exposes a bottom-aligned debug action', () => {
  const source = fs.readFileSync(require.resolve('../reader-study-tools-rail.js'), 'utf8');
  const css = fs.readFileSync(require.resolve('../speed-reading-v2.css'), 'utf8');

  assert.match(source, /id:\s*'readerStudyToolsDebug'/);
  assert.match(source, /title:\s*'打开节点调试页'/);
  assert.match(source, /text:\s*'🐞'/);
  assert.match(css, /\.reader-study-tools-debug\s*\{[^}]*margin-top:\s*auto/s);
});
