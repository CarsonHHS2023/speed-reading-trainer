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

test('tool registry exposes notes, highlights, and study context', () => {
  assert.deepEqual(Rail.TOOL_DEFINITIONS.map((tool) => tool.id), [
    'notes', 'highlights', 'study-context',
  ]);
});

test('rail CSS keeps a narrow visible strip while collapsed and overlays on small screens', () => {
  const css = fs.readFileSync(require.resolve('../speed-reading-v2.css'), 'utf8');
  assert.match(css, /--reader-study-tools-rail-width:\s*46px/);
  assert.match(css, /reader-study-tools-rail\[data-expanded="0"\]/);
  assert.match(css, /reader-study-tools-drawer/);
  assert.match(css, /@media\s*\(max-width:\s*900px\)/);
});
