const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(
  path.join(__dirname, '..', 'reader-semantic-page.css'),
  'utf8',
);

test('suppresses browser list markers only for normalized toc items', () => {
  assert.match(
    css,
    /\.reader-v2-semantic-page-toc-item \.reader-v2-node-text\s*\{[^}]*display:\s*block;[^}]*padding-inline-start:\s*0;[^}]*list-style:\s*none;/s,
  );
  assert.match(
    css,
    /\.reader-v2-semantic-page-toc-item \.reader-v2-node-text::marker\s*\{[^}]*content:\s*'';/s,
  );
  assert.doesNotMatch(
    css,
    /(^|\n)\s*\.reader-v2-node-list_item \.reader-v2-node-text\s*\{[^}]*list-style:\s*none;/s,
  );
});
