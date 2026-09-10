const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'reader-semantic-page.css'), 'utf8');

test('TOC diagnostics stay hidden unless the explicit debug flag is enabled', () => {
  assert.match(
    css,
    /\.reader-v2-toc-structure-debug\s*\{[^}]*display:\s*none;/s,
  );
  assert.match(
    css,
    /:root\[data-reader-toc-debug="true"\]\s+\.reader-v2-toc-structure-debug,/s,
  );
  assert.match(
    css,
    /body\[data-reader-toc-debug="true"\]\s+\.reader-v2-toc-structure-debug\s*\{[^}]*display:\s*block;/s,
  );
});
