const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ReaderModel = require('../reader-model.js');
const { ReaderV2Controller, safeMessage, NODE_LIMIT, MAX_VISIBLE_WINDOWS } = require('../reader-ui-v2.js');

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.textContent = '';
  }
  appendChild(child) { this.children.push(child); return child; }
}

class FakeDocument {
  createElement(tag) { return new FakeElement(tag); }
}

function paragraph() {
  return {
    node_id: 'n1',
    node_type: 'paragraph',
    order: 1,
    text: 'Body has Needle and needle.',
    content_state: 'ready',
    source_unit_ids: ['f1'],
    location: { node_id: 'n1', source_unit_id: 'f1' },
  };
}

test('Reader v2 UI exposes the authoritative bounded window contract', () => {
  assert.equal(NODE_LIMIT, 150);
  assert.equal(MAX_VISIBLE_WINDOWS, 2);
});

test('Reader v2 active find result renders a mark without rewriting canonical node text', () => {
  const controller = Object.create(ReaderV2Controller.prototype);
  controller.document = new FakeDocument();
  controller.model = ReaderModel;
  controller.assets = { defaultLabel() { return ''; } };
  controller.findResults = [{ node_id: 'n1', match_start: 9, match_end: 15 }];
  controller.findIndex = 0;
  controller.openResponse = {
    contract_version: '2',
    document_ref: 'doc-1',
    candidate_id: 'candidate-1',
    candidate_schema_id: 'atlas.structured-content.v2',
    candidate_schema_version: 2,
  };
  controller.finder = { sameCandidate() { return true; } };
  const node = paragraph();

  const rendered = controller.renderNode(node);
  const textContainer = rendered.children[0];
  assert.equal(textContainer.children.some((child) => child.tagName === 'MARK' && child.textContent === 'Needle'), true);
  assert.equal(node.text, 'Body has Needle and needle.');
});

test('Reader v2 UI exposes bounded selection errors', () => {
  assert.equal(safeMessage({ code: 'reader_selection_changed' }), '阅读内容版本已经变化，请重新打开文档。');
  assert.equal(safeMessage({ code: 'reader_not_ready' }), '这本文档还没有可读取的结构化内容。');
});

test('BookShelf selected-book path is natively Reader v2 and has no legacy content fallback', () => {
  const source = fs.readFileSync('bookshelf.js', 'utf8');
  const start = source.indexOf('    async selectBook(bookId)');
  const end = source.indexOf('    moveBookToCategory(', start);
  assert.ok(start >= 0 && end > start);
  const selectedBookPath = source.slice(start, end);
  assert.match(selectedBookPath, /ReaderUIV2\.openBook\(this\.currentBook\)/);
  assert.match(selectedBookPath, /resetReaderV2Session/);
  for (const forbidden of ['/api/v1/books/${encodeURIComponent(bookId)}/content', 'cachedContentBlob', 'state.content', 'imageMarkerMap', '/api/reader/v1', 'BookShelf.prototype.selectBook']) {
    assert.equal(selectedBookPath.includes(forbidden), false, forbidden);
  }
});

test('deleting the active book clears Reader v2 instead of legacy playback state', () => {
  const source = fs.readFileSync('bookshelf.js', 'utf8');
  const start = source.indexOf('    async deleteBook(bookId)');
  const end = source.indexOf('    moveBookToCategory(', start);
  const deletePath = source.slice(start, end);
  assert.match(deletePath, /this\.resetReaderV2Session\(\)/);
  assert.match(deletePath, /\/api\/v1\/books\/\$\{encodeURIComponent\(bookId\)\}/);
  assert.doesNotMatch(deletePath, /cachedContentBlob|state\.content|imageMarkerMap|tokenizeContent/);
});

test('main HTML mounts Reader v2 find before UI and has no cutover shim', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const file of ['reader-api.js', 'reader-model.js', 'reader-presentation.js', 'reader-assets.js', 'reader-find.js', 'reader-ui-v2.js', 'bookshelf.js']) {
    assert.match(html, new RegExp(file.replace('.', '\\.')));
  }
  assert.ok(html.indexOf('reader-find.js') < html.indexOf('reader-ui-v2.js'));
  assert.match(html, /id="readerV2FindInput"/);
  assert.match(html, /id="readerV2Display"/);
  assert.doesNotMatch(html, /reader-bookshelf-cutover\.js|readerModeToggle|Reader\s*β/);
  assert.equal(fs.existsSync('reader-bookshelf-cutover.js'), false);
});
