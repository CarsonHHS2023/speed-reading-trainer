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
    playback: { snapshot: () => ({ frame: null }) },
  };
  assert.equal(
    DebugToolbar.buildDebugUrl(controller),
    'reader-node-debug.html?document_ref=doc+1&candidate_id=candidate-1&source_unit_id=pdf-page%3A000005',
  );
});

test('playback frame page takes precedence over the Reader last location', () => {
  const controller = {
    reader: {
      documentRef: 'doc-1',
      candidateId: 'candidate-1',
      lastLocation: { source_unit_id: 'pdf-page:000004' },
    },
    playback: {
      snapshot: () => ({ frame: { identity: { source_unit_id: 'pdf-page:000009' } } }),
    },
  };
  assert.match(DebugToolbar.buildDebugUrl(controller), /source_unit_id=pdf-page%3A000009/);
});

test('debug URL is unavailable until a Reader candidate is open', () => {
  assert.equal(DebugToolbar.buildDebugUrl({ reader: { documentRef: 'doc-1' } }), null);
});

test('main page loads debug toolbar after playback toolbar creation', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /reader-debug-toolbar\.js/);
  assert.ok(html.indexOf('reader-speed-playback-ui.js') < html.indexOf('reader-debug-toolbar.js'));
});
