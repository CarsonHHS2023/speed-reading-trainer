const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { ReaderV2Controller, safeMessage } = require('../reader-ui-v2.js');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.classList = new FakeClassList();
    this.style = { setProperty() {} };
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.clientWidth = 700;
  }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); return child; }
  replaceChildren(...children) { this.children = children; }
  get firstChild() { return this.children[0] || null; }
  addEventListener() {}
  scrollIntoView() {}
  focus() {}
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement('body');
    this.body.dataset = {};
    this.map = new Map();
    const ids = [
      'readerV2Display', 'focusModeDisplay', 'pageModeDisplay', 'chartDisplay', 'readingToggleBtn',
      'readerV2Status', 'readerV2Navigation', 'readerV2Pages', 'readerV2LoadMore', 'readerV2Title', 'readerV2Meta',
      'readerV2FindInput', 'readerV2FindButton', 'readerV2FindPrev', 'readerV2FindNext', 'readerV2FindCount',
      'widthInput', 'maxLinesInput', 'fontInput', 'widthSlider', 'maxLinesSlider', 'fontSlider',
    ];
    for (const id of ids) this.map.set(id, new FakeElement());
    this.map.get('widthInput').value = '35';
    this.map.get('maxLinesInput').value = '20';
    this.map.get('fontInput').value = '28';
    this.main = new FakeElement();
  }
  getElementById(id) { return this.map.get(id) || null; }
  querySelector(selector) {
    if (selector === '.reader-v2-main') return this.main;
    return null;
  }
  createElement(tag) { return new FakeElement(tag); }
}

function identity(extra = {}) {
  return {
    contract_version: '2',
    document_ref: 'doc-1',
    candidate_id: 'candidate-1',
    candidate_schema_id: 'atlas.structured-content.v2',
    candidate_schema_version: 2,
    ...extra,
  };
}

function makeApi(calls = []) {
  return {
    async open(documentRef) {
      calls.push(['open', documentRef]);
      return identity({
        metadata: { source_unit_count: 1, physical_page_count: 0, reflowable_source_unit_count: 1 },
        source_units: [{ source_unit_id: 'f1', source_order: 0, kind: 'text_flow' }],
      });
    },
    async navigation(documentRef, options) {
      calls.push(['navigation', documentRef, options.candidateId]);
      return identity({ navigation: [{ label: 'Heading', heading_level: 1, location: { node_id: 'h1' } }] });
    },
    async content(documentRef, options) {
      calls.push(['content', documentRef, options.startNodeOrder, options.candidateId]);
      if (options.startNodeOrder === 0) {
        return identity({
          nodes: [{ node_id: 'h1', node_type: 'heading', order: 0, text: 'Heading', content_state: 'ready', source_unit_ids: ['f1'], location: { node_id: 'h1', source_unit_id: 'f1' } }],
          has_more: true,
          next_node_order: 1,
        });
      }
      return identity({
        nodes: [{ node_id: 'n1', node_type: 'paragraph', order: 1, text: 'Body has Needle and needle.', content_state: 'ready', source_unit_ids: ['f1'], location: { node_id: 'n1', source_unit_id: 'f1', source_anchor: { kind: 'text_span', source_unit_id: 'f1', start: 10, end: 37 } } }],
        has_more: false,
        next_node_order: null,
      });
    },
  };
}

test('Reader v2 controller opens, navigates, and continues by node order', async () => {
  const calls = [];
  const documentObject = new FakeDocument();
  const controller = new ReaderV2Controller({ api: makeApi(calls), documentObject });

  await controller.openBook({ id: 'doc-1', name: 'Demo' });
  assert.equal(documentObject.body.dataset.readerV2Active, '1');
  assert.equal(controller.nextNodeOrder, 1);
  assert.deepEqual(controller.nodes.map((node) => node.node_id), ['h1']);
  await controller.loadMore();
  assert.deepEqual(controller.nodes.map((node) => node.node_id), ['h1', 'n1']);
  assert.deepEqual(calls, [
    ['open', 'doc-1'],
    ['navigation', 'doc-1', 'candidate-1'],
    ['content', 'doc-1', 0, 'candidate-1'],
    ['content', 'doc-1', 1, 'candidate-1'],
  ]);
});

test('Reader v2 find loads later semantic chunks and keeps stable candidate/node identity', async () => {
  const calls = [];
  const documentObject = new FakeDocument();
  const controller = new ReaderV2Controller({ api: makeApi(calls), documentObject });
  await controller.openBook({ id: 'doc-1', name: 'Demo' });

  const results = await controller.runFind('needle');
  assert.equal(controller.hasMore, false);
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((item) => item.matched_text), ['Needle', 'needle']);
  assert.ok(results.every((item) => item.identity.candidate_id === 'candidate-1'));
  assert.ok(results.every((item) => item.identity.node_id === 'n1'));
  assert.equal(documentObject.getElementById('readerV2FindCount').textContent, '1 / 2');

  controller.navigateFind(1);
  assert.equal(controller.findIndex, 1);
  assert.equal(documentObject.getElementById('readerV2FindCount').textContent, '2 / 2');

  controller.openResponse = { ...controller.openResponse, candidate_id: 'candidate-2' };
  controller.navigateFind(1);
  assert.equal(controller.findResults.length, 0);
});

test('Reader v2 active find result renders a mark without rewriting node text', async () => {
  const documentObject = new FakeDocument();
  const controller = new ReaderV2Controller({ api: makeApi([]), documentObject });
  await controller.openBook({ id: 'doc-1', name: 'Demo' });
  await controller.runFind('needle');
  const node = controller.nodes.find((item) => item.node_id === 'n1');
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
