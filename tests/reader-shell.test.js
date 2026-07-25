const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('index.html', 'utf8');
const ui = fs.readFileSync('reader-ui.js', 'utf8');

test('structured Reader remains an explicit opt-in mode', () => {
  assert.match(html, /id="readerModeToggle"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(ui, /m5\.reader\.v1\.enabled/);
  assert.match(ui, /reader_v1/);
});

test('Reader shell exposes semantic navigation, live status, and keyboard page navigation', () => {
  assert.match(html, /<nav class="reader-navigation-panel" aria-label="文档标题导航">/);
  assert.match(html, /id="readerStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="readerContent"[^>]*tabindex="-1"/);
  assert.match(ui, /event\.altKey && event\.key === 'ArrowLeft'/);
  assert.match(ui, /event\.altKey && event\.key === 'ArrowRight'/);
});

test('Reader does not replace the legacy content endpoint in bookshelf source', () => {
  const bookshelf = fs.readFileSync('bookshelf.js', 'utf8');
  assert.match(bookshelf, /\/api\/v1\/books\/\$\{encodeURIComponent\(bookId\)\}\/content/);
  assert.match(ui, /originalSelectBook\.call/);
});

test('structured delivery is bounded and lazy by construction', () => {
  assert.match(ui, /const PAGE_LIMIT = 20/);
  assert.match(ui, /readerLoadMoreBtn/);
  assert.match(ui, /loadAsset\(/);
  assert.match(ui, /loadTable\(/);
});
