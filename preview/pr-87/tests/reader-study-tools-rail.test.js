const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Rail = require('../reader-study-tools-rail.js');

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test('study tools rail defaults to collapsed notes tool', () => {
  assert.deepEqual(Rail.normalizeState(null), { expanded: false, activeToolId: 'notes' });
  assert.deepEqual(Rail.loadState(memoryStorage()), { expanded: false, activeToolId: 'notes' });
});

test('study tools rail restores valid state and rejects unknown tool ids', () => {
  const valid = memoryStorage({
    [Rail.STORAGE_KEY]: JSON.stringify({ expanded: true, activeToolId: 'highlights' }),
  });
  assert.deepEqual(Rail.loadState(valid), { expanded: true, activeToolId: 'highlights' });

  const invalid = memoryStorage({
    [Rail.STORAGE_KEY]: JSON.stringify({ expanded: true, activeToolId: 'missing-tool' }),
  });
  assert.deepEqual(Rail.loadState(invalid), { expanded: true, activeToolId: 'notes' });
});

test('tool registry exposes navigation, notes, highlights, and study context', () => {
  assert.deepEqual(Rail.TOOL_DEFINITIONS.map((tool) => tool.id), [
    'navigation', 'notes', 'highlights', 'study-context',
  ]);
  const navigation = Rail.TOOL_DEFINITIONS.find((tool) => tool.id === 'navigation');
  assert.deepEqual(navigation.selectors, [
    '.reader-v2-title', '.reader-v2-meta', '.reader-v2-find', '.reader-v2-navigation',
  ]);
});

test('study tools layout change never activates or refreshes idle speed-reading playback', () => {
  let refreshCount = 0;
  let showCount = 0;
  const playbackController = {
    isReaderActive: () => true,
    playback: {
      state: 'paused',
      currentFrame: () => ({ frame_id: 'f1' }),
    },
    trainingClock: { state: 'idle' },
    refreshFrames() { refreshCount += 1; },
    showPlaybackSurface() { showCount += 1; },
  };
  const windowObject = {
    ReaderSpeedPlaybackUI: { getDefaultController: () => playbackController },
    setTimeout(callback) { callback(); },
  };
  const controller = new Rail.StudyToolsRailController({ documentObject: {}, windowObject });
  controller.requestPlaybackReflow();
  assert.equal(refreshCount, 0);
  assert.equal(showCount, 0);
});

test('study tools layout change reflows an actually engaged speed-reading session', () => {
  let refreshCount = 0;
  let showCount = 0;
  const frame = { frame_id: 'f1' };
  const playbackController = {
    isReaderActive: () => true,
    playback: {
      state: 'paused',
      currentFrame: () => frame,
    },
    trainingClock: { state: 'running' },
    refreshFrames() { refreshCount += 1; },
    showPlaybackSurface(value) { assert.equal(value, frame); showCount += 1; },
  };
  const windowObject = {
    ReaderSpeedPlaybackUI: { getDefaultController: () => playbackController },
    setTimeout(callback) { callback(); },
  };
  const controller = new Rail.StudyToolsRailController({ documentObject: {}, windowObject });
  controller.requestPlaybackReflow();
  assert.equal(refreshCount, 1);
  assert.equal(showCount, 1);
});

test('rail CSS keeps a narrow visible strip, removes the legacy sidebar, pushes wide layouts, and overlays on small screens', () => {
  const css = fs.readFileSync(require.resolve('../speed-reading-v2.css'), 'utf8');
  assert.match(css, /--study-tools-rail-width:\s*46px/);
  assert.match(css, /data-study-tools-ready="1"[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /data-study-tools-ready="1"[^}]*reader-v2-sidebar[^}]*display:\s*none/s);
  assert.match(css, /\.reader-study-tools-rail\s*\{[^}]*width:\s*var\(--study-tools-rail-width\)/s);
  assert.match(css, /data-study-tools-expanded="1"[^}]*width:\s*calc\(100%\s*-\s*var\(--study-tools-rail-width\)\s*-\s*var\(--study-tools-drawer-width\)\)/s);
  assert.match(css, /reader-study-tools-drawer/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
});
