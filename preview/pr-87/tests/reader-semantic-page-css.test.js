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

test('semantic body paragraphs use a two-character first-line indent', () => {
  assert.match(
    css,
    /\.reader-v2-node-paragraph:not\(\[data-reader-fragment-index\]\)\s*>\s*\.reader-v2-node-text,/s,
  );
  assert.match(
    css,
    /\.reader-v2-node-paragraph\[data-reader-fragment-index="0"\]\s*>\s*\.reader-v2-node-text\s*\{[^}]*text-indent:\s*2em;/s,
  );
  assert.doesNotMatch(
    css,
    /data-reader-fragment-index="1"[^}]*text-indent/s,
  );
  assert.doesNotMatch(
    css,
    /\.reader-v2-semantic-page-toc-item[^}]*text-indent/s,
  );
});

test('text slots remain clipped until width-first adaptation releases height', () => {
  assert.match(
    css,
    /\.reader-v2-semantic-page-element--text\s*\{[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    css,
    /\.reader-v2-semantic-page-element--text\.reader-v2-semantic-page-element--width-expanded\s*\{[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    css,
    /\.reader-v2-semantic-page-element--text\.reader-v2-semantic-page-element--height-expanded\s*\{[^}]*height:\s*auto\s*!important;[^}]*overflow:\s*visible;/s,
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

test('cover source rendering fills the page without distortion or viewport height caps', () => {
  assert.match(
    css,
    /\.reader-v2-semantic-page-element--cover-source-rendering \.reader-v2-asset-image\s*\{[^}]*width:\s*100%\s*!important;[^}]*height:\s*100%\s*!important;/s,
  );
  assert.match(
    css,
    /\.reader-v2-semantic-page-element--cover-source-rendering \.reader-v2-asset-image\s*\{[^}]*max-height:\s*none\s*!important;/s,
  );
  assert.match(
    css,
    /\.reader-v2-semantic-page-element--cover-source-rendering \.reader-v2-asset-image\s*\{[^}]*object-fit:\s*contain;/s,
  );
  assert.doesNotMatch(
    css,
    /\.reader-v2-semantic-page-element--cover-source-rendering \.reader-v2-asset-image\s*\{[^}]*object-fit:\s*fill;/s,
  );
});
