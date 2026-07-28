const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('reader enhancements install structure policy, responsive layout, playback polish, then tools rail', () => {
  const source = fs.readFileSync(require.resolve('../reader-resume-lifecycle.js'), 'utf8');
  const structure = source.indexOf('speed-reading-structure-policy.js');
  const responsive = source.indexOf('speed-reading-responsive-layout.js');
  const polish = source.indexOf('reader-playback-polish.js');
  const rail = source.indexOf('reader-study-tools-rail.js');

  assert.ok(structure >= 0, 'structure policy loader is present');
  assert.ok(responsive > structure, 'responsive layout loads after structure policy');
  assert.ok(polish > responsive, 'playback polish loads after responsive layout');
  assert.ok(rail > polish, 'study tools rail loads after playback polish');
});

test('study tools layout changes request identity-preserving playback reflow', () => {
  const source = fs.readFileSync(require.resolve('../reader-study-tools-rail.js'), 'utf8');
  assert.match(source, /reader-study-tools-layout-change/);
  assert.match(source, /refreshFrames\?\.\(\{\s*preserveIdentity:\s*true\s*\}\)/);
});
