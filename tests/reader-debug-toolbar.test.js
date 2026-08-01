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

test('main page loads debug toolbar after playback toolbar creation', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /reader-debug-toolbar\.js/);
  assert.ok(html.indexOf('reader-speed-playback-ui.js') < html.indexOf('reader-debug-toolbar.js'));
});
