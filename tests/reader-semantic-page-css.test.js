const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'reader-semantic-page.css'), 'utf8');

test('semantic full-page CSS styles page furniture as auxiliary content', () => {
  for (const nodeType of ['header', 'footer', 'footnote']) {
    assert.match(css, new RegExp(`reader-v2-node-${nodeType}`));
  }
  assert.match(css, /font-size:\s*clamp\(/);
  assert.match(css, /color-mix\(in srgb, currentColor 72%, transparent\)/);
});

test('footer furniture aligns to the bottom of its spatial region', () => {
  assert.match(css, /\.reader-v2-semantic-page-element \.reader-v2-node-footer\s*\{[^}]*align-items:\s*flex-end;/s);
});

test('text slots expand beyond undersized OCR boxes while visual slots remain clipped', () => {
  assert.match(
    css,
    /\.reader-v2-semantic-page-element--text\s*\{[^}]*height:\s*auto\s*!important;[^}]*overflow:\s*visible;/s,
  );
  assert.match(
    css,
    /\.reader-v2-semantic-page-element--text[^}]*\.reader-v2-node-text\s*\{[^}]*height:\s*auto;[^}]*overflow:\s*visible;/s,
  );
  assert.match(
    css,
    /\.reader-v2-semantic-page-element--visual\s*\{[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    css,
    /\.reader-v2-semantic-page-element--visual > \.reader-v2-node\s*\{[^}]*height:\s*100%;/s,
  );
});