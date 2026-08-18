const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('booklist playback controls use distinct enabled, disabled, and primary states on the blue header', () => {
  const css = fs.readFileSync('reader-page-zoom-pan.css', 'utf8');

  assert.match(
    css,
    /reader-booklist-playback-controls button\s*\{[^}]*background:\s*rgba\(255, 255, 255, \.16\)[^}]*color:\s*rgba\(255, 255, 255, \.96\)/s,
  );
  assert.match(
    css,
    /reader-booklist-playback-controls button:disabled\s*\{[^}]*opacity:\s*1[^}]*background:\s*rgba\(255, 255, 255, \.05\)[^}]*color:\s*rgba\(255, 255, 255, \.32\)/s,
  );
  assert.match(
    css,
    /reader-booklist-playback-controls \.reading-toggle-btn:not\(:disabled\)\s*\{[^}]*background:\s*rgba\(255, 255, 255, \.30\)[^}]*color:\s*#fff/s,
  );
  assert.match(
    css,
    /reader-booklist-playback-controls \.reading-toggle-btn\.active:not\(:disabled\)\s*\{[^}]*background:\s*rgba\(255, 105, 105, \.42\)/s,
  );
});
