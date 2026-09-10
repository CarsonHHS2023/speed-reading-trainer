const test = require('node:test');
const assert = require('node:assert/strict');

const { ReaderV2Controller, NODE_LIMIT, MAX_VISIBLE_WINDOWS, windowStartForOrder } = require('../reader-ui-v2.js');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) {
    if (force === false) this.values.delete(value);
    else if (force === true || !this.values.has(value)) this.values.add(value);
    else this.values.delete(value);
  }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.classList = new FakeClassList();
    this.className = '';
    this.style = { setProperty() {} };
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.clientWidth = 700;
    this.clientHeight = 800;
    this.scrollTop = 0;
    this.scrollHeight = 1600;
  }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); return child; }
  get firstChild() { return this.children[0] || null; }
  addEventListener() {}
  setAttribute() {}
  removeAttribute() {}
  scrollIntoView() { this.scrolled = true; }
  focus() {}
  getBoundingClientRect() { return { top: 0, bottom: 800, height: 800 }; }
  querySelectorAll(selector) {
    if (selector === '.reader-v2-page') return this.children.filter((child) => String(child.className).includes('reader-v2-page'));
    if (selector === '.reader-v2-nav-item') return this.children.filter((child) => String(child.className).includes('reader-v2-nav-item'));
    return [];
  }
}

class FakeCustomEvent {
  constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement('body');
    this.body.dataset = {};
    this.defaultView = { CustomEvent: FakeCustomEvent, requestAnimationFrame(callback) { callback(); } };
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
    const match = String(selector).match(/data-reader-node-id="([^"]+)"/);
    if (!match) return null;
    const expected = match[1];
    const pages = this.map.get('readerV2Pages');
    for (const page of pages.children) {
      for (const child of page.children || []) {
        if (String(child.dataset?.readerNodeId || '') === expected) return child;
      }
    }
    return null;
  }
  createElement(tag) { return new FakeElement(tag); }
  dispatchEvent() { return true; }
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

function makeNode(order, text = `body ${order}`) {
  return {
    node_id: `n${order}`,
    node_type: order % 150 === 0 ? 'heading' : 'paragraph',
    heading_level: order % 150 === 0 ? 1 : null,
    order,
    text,
    content_state: 'ready',
    source_unit_ids: ['flow-1'],
    location: { node_id: `n${order}`, source_unit_id: 'flow-1' },
  };
}

function makeApi(total = 1000, calls = [], needleOrder = null) {
  return {
    async open(documentRef) {
      calls.push(['open', documentRef]);
      return identity({
        metadata: { source_unit_count: 1, physical_page_count: 0, reflowable_source_unit_count: 1 },
        source_units: [{ source_unit_id: 'flow-1', source_order: 0, kind: 'text_flow' }],
      });
    },
    async navigation(documentRef, options) {
      calls.push(['navigation', documentRef, options.candidateId]);
      return identity({ navigation: [] });
    },
    async content(documentRef, options) {
      calls.push(['content', documentRef, options.startNodeOrder, options.limit]);
      const start = Number(options.startNodeOrder);
      const end = Math.min(total, start + Number(options.limit));
      const nodes = [];
      for (let order = start; order < end; order += 1) {
        nodes.push(makeNode(order, order === needleOrder ? `body ${order} Needle` : `body ${order}`));
      }
      return identity({
        nodes,
        has_more: end < total,
        next_node_order: end < total ? end : null,
      });
    },
  };
}

function makeResumeStore(record = null) {
  return {
    current: record,
    read() { return this.current; },
    write(next) { this.current = next; return next; },
    clear() { this.current = null; },
  };
}

function contentStarts(calls) {
  return calls.filter((call) => call[0] === 'content').map((call) => call[2]);
}

test('Reader window constants align semantic node orders to 150-node batches', () => {
  assert.equal(NODE_LIMIT, 150);
  assert.equal(MAX_VISIBLE_WINDOWS, 2);
  assert.equal(windowStartForOrder(0), 0);
  assert.equal(windowStartForOrder(149), 0);
  assert.equal(windowStartForOrder(150), 150);
  assert.equal(windowStartForOrder(620), 600);
});

test('first-time open loads only the first 150-node window', async () => {
  const calls = [];
  const controller = new ReaderV2Controller({
    api: makeApi(1000, calls),
    documentObject: new FakeDocument(),
    resumeStore: makeResumeStore(),
  });
  await controller.openBook({ id: 'doc-1', name: 'Demo' });

  assert.deepEqual(contentStarts(calls), [0]);
  assert.deepEqual(controller.visibleStarts(), [0]);
  assert.equal(controller.nodes.length, 150);
  assert.equal(controller.nodes[0].order, 0);
  assert.equal(controller.nodes.at(-1).order, 149);
});

test('ordered resume loads only its aligned window and following window', async () => {
  const calls = [];
  const store = makeResumeStore(identity({
    version: 1,
    node_id: 'n620',
    node_order: 620,
    source_unit_id: 'flow-1',
    updated_at: 1,
  }));
  const controller = new ReaderV2Controller({
    api: makeApi(1000, calls),
    documentObject: new FakeDocument(),
    resumeStore: store,
  });
  await controller.openBook({ id: 'doc-1', name: 'Demo' });

  assert.deepEqual(contentStarts(calls), [600, 750]);
  assert.deepEqual(controller.visibleStarts(), [600, 750]);
  assert.equal(controller.nodes.length, 300);
  assert.equal(controller.nodes[0].order, 600);
  assert.equal(controller.nodes.at(-1).order, 899);
  assert.equal(controller.lastLocation.node_id, 'n620');
});

test('successive forward loads keep only two adjacent windows visible', async () => {
  const calls = [];
  const controller = new ReaderV2Controller({
    api: makeApi(1000, calls),
    documentObject: new FakeDocument(),
    resumeStore: makeResumeStore(),
  });
  await controller.openBook({ id: 'doc-1' });
  await controller.loadMore({ silent: true });
  assert.deepEqual(controller.visibleStarts(), [0, 150]);
  assert.equal(controller.nodes.length, 300);

  await controller.loadMore({ silent: true });
  assert.deepEqual(controller.visibleStarts(), [150, 300]);
  assert.equal(controller.nodes.length, 300);
  assert.equal(controller.nodes[0].order, 150);
  assert.equal(controller.nodes.at(-1).order, 449);
});

test('legacy resume probes once, upgrades node_order, then uses the bounded history pair', async () => {
  const calls = [];
  const store = makeResumeStore(identity({
    version: 1,
    node_id: 'n320',
    node_order: null,
    source_unit_id: 'flow-1',
    updated_at: 1,
  }));
  const controller = new ReaderV2Controller({
    api: makeApi(700, calls),
    documentObject: new FakeDocument(),
    resumeStore: store,
  });
  await controller.openBook({ id: 'doc-1' });

  assert.deepEqual(contentStarts(calls), [0, 150, 300, 450]);
  assert.equal(store.current.node_order, 320);
  assert.deepEqual(controller.visibleStarts(), [300, 450]);
  assert.ok(controller.nodes.length <= 300);
});

test('whole-book find scans chunks without expanding the visible Reader beyond two windows', async () => {
  const calls = [];
  const controller = new ReaderV2Controller({
    api: makeApi(700, calls, 470),
    documentObject: new FakeDocument(),
    resumeStore: makeResumeStore(),
  });
  await controller.openBook({ id: 'doc-1' });
  const results = await controller.runFind('Needle');

  assert.equal(results.length, 1);
  assert.equal(results[0].node_order, 470);
  assert.deepEqual(controller.visibleStarts(), [450, 600]);
  assert.ok(controller.nodes.length <= 300);
});
