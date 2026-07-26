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

test('Reader v2 controller opens, navigates, and continues by node order', async () => {
  const calls = [];
  const api = {
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
        nodes: [{ node_id: 'n1', node_type: 'paragraph', order: 1, text: 'Body', content_state: 'ready', source_unit_ids: ['f1'], location: { node_id: 'n1', source_unit_id: 'f1' } }],
        has_more: false,
        next_node_order: null,
      });
    },
  };
  const documentObject = new FakeDocument();
  const controller = new ReaderV2Controller({ api, documentObject });

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

test('Reader v2 UI exposes bounded selection errors', () => {
  assert.equal(safeMessage({ code: 'reader_selection_changed' }), '阅读内容版本已经变化，请重新打开文档。');
  assert.equal(safeMessage({ code: 'reader_not_ready' }), '这本文档还没有可读取的结构化内容。');
});

test('bookshelf cutover delegates selection to Reader v2 without a legacy content request', () => {
  const source = fs.readFileSync('reader-bookshelf-cutover.js', 'utf8');
  assert.match(source, /ReaderUIV2\.openBook/);
  assert.doesNotMatch(source, /\/api\/v1\/books\/.*\/content/);
  assert.doesNotMatch(source, /\/api\/reader\/v1/);
  assert.doesNotMatch(source, /Reader\s*β|reader_v1|readerModeToggle/);
});

test('main HTML mounts Reader v2 cutover scripts and has no Reader beta toggle', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  for (const file of ['reader-api.js', 'reader-model.js', 'reader-presentation.js', 'reader-ui-v2.js', 'reader-bookshelf-cutover.js']) {
    assert.match(html, new RegExp(file.replace('.', '\\.')));
  }
  assert.match(html, /id="readerV2Display"/);
  assert.doesNotMatch(html, /readerModeToggle|Reader\s*β/);
});
