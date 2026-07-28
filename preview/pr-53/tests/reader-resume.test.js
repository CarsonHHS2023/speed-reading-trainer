const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Resume = require('../reader-resume.js');
const { ReaderV2Controller } = require('../reader-ui-v2.js');
const { ReaderSpeedPlaybackUIController } = require('../reader-speed-playback-ui.js');

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  toggle(value, force) { if (force === false) this.values.delete(value); else this.values.add(value); }
}

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.classList = new FakeClassList();
    this.style = { setProperty() {} };
    this.textContent = '';
    this.value = '';
    this.max = '1000';
    this.hidden = false;
    this.disabled = false;
    this.clientWidth = 700;
  }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); return child; }
  replaceChildren(...children) { this.children = [...children]; }
  get firstChild() { return this.children[0] || null; }
  addEventListener() {}
  scrollIntoView() { this.scrolled = true; }
  focus() { this.focused = true; }
}

function findByNodeId(element, nodeId) {
  if (element?.dataset?.readerNodeId === nodeId) return element;
  for (const child of element?.children || []) {
    const found = findByNodeId(child, nodeId);
    if (found) return found;
  }
  return null;
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement('body');
    this.body.dataset = { readerV2Active: '1' };
    this.map = new Map();
    const ids = [
      'readerV2Display', 'focusModeDisplay', 'pageModeDisplay', 'chartDisplay', 'readingToggleBtn',
      'readerV2Status', 'readerV2Navigation', 'readerV2Pages', 'readerV2LoadMore', 'readerV2Title', 'readerV2Meta',
      'readerV2FindInput', 'readerV2FindButton', 'readerV2FindPrev', 'readerV2FindNext', 'readerV2FindCount',
      'widthInput', 'maxLinesInput', 'fontInput', 'widthSlider', 'maxLinesSlider', 'fontSlider',
      'displayMode', 'linesInput', 'speedInput', 'currentPos', 'totalWords', 'progressSlider', 'focusText', 'pageText',
    ];
    for (const id of ids) this.map.set(id, new FakeElement());
    this.map.get('widthInput').value = '35';
    this.map.get('maxLinesInput').value = '20';
    this.map.get('fontInput').value = '28';
    this.map.get('displayMode').value = 'focus';
    this.map.get('linesInput').value = '3';
    this.map.get('speedInput').value = '600';
    this.main = new FakeElement();
  }
  getElementById(id) { return this.map.get(id) || null; }
  createElement(tag) { return new FakeElement(tag); }
  querySelector(selector) {
    if (selector === '.reader-v2-main') return this.main;
    const match = selector.match(/^\[data-reader-node-id="(.+)"\]$/);
    if (match) return findByNodeId(this.map.get('readerV2Pages'), match[1]);
    return null;
  }
}

function identity(extra = {}) {
  return {
    contract_version: '2',
    document_ref: 'doc-1',
    candidate_id: 'cand-1',
    candidate_schema_id: 'atlas.structured-content.v2',
    candidate_schema_version: 2,
    ...extra,
  };
}

function node(id, order) {
  return {
    node_id: id,
    node_type: 'paragraph',
    order,
    text: `text ${id}`,
    content_state: 'ready',
    source_unit_ids: ['flow-1'],
    source_anchors: [{ kind: 'text_span', start: order * 10, end: order * 10 + 5 }],
    location: identity({ node_id: id, source_unit_id: 'flow-1', source_anchor: { kind: 'text_span', start: order * 10, end: order * 10 + 5 } }),
  };
}

test('resume store serializes only stable Reader v2 semantic identity', () => {
  const storage = new MemoryStorage();
  const store = new Resume.ReaderResumeStoreV2({ storage });
  const record = Resume.recordForLocation(identity(), identity({
    node_id: 'n1',
    source_unit_id: 'flow-1',
    source_anchor: { kind: 'text_span', start: 10, end: 20 },
  }), { frameId: 'frame-1', frameOrdinal: 2, updatedAt: 123 });
  store.write(record);
  assert.deepEqual(store.read('doc-1'), record);
  const serialized = [...storage.values.values()][0];
  for (const forbidden of ['presentation_id', 'page_id', 'scroll', 'token', 'state.content', 'cachedContentBlob']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('candidate changes and malformed old records fail closed', () => {
  const storage = new MemoryStorage();
  const store = new Resume.ReaderResumeStoreV2({ storage });
  const record = Resume.recordForLocation(identity(), identity({ node_id: 'n1' }));
  store.write(record);
  assert.equal(Resume.sameCandidate(record, identity({ candidate_id: 'cand-2' })), false);
  storage.setItem(Resume.storageKey('bad'), JSON.stringify({ version: 99, document_ref: 'bad' }));
  assert.equal(store.read('bad'), null);
  assert.equal(storage.getItem(Resume.storageKey('bad')), null);
});

test('Reader v2 restore loads later chunks and restores semantic node without auto playback', async () => {
  const storage = new MemoryStorage();
  const store = new Resume.ReaderResumeStoreV2({ storage });
  store.write(Resume.recordForLocation(identity(), identity({
    node_id: 'n2',
    source_unit_id: 'flow-1',
    source_anchor: { kind: 'text_span', start: 10, end: 15 },
  }), { updatedAt: 123 }));

  const calls = [];
  const api = {
    async open() { return identity({ metadata: { source_unit_count: 1, physical_page_count: 0, reflowable_source_unit_count: 1 }, source_units: [{ source_unit_id: 'flow-1', source_order: 0, kind: 'text_flow' }] }); },
    async navigation() { return identity({ navigation: [] }); },
    async content(_documentRef, options) {
      calls.push(options.startNodeOrder);
      if (options.startNodeOrder === 0) return identity({ nodes: [node('n1', 0)], has_more: true, next_node_order: 1 });
      return identity({ nodes: [node('n2', 1)], has_more: false, next_node_order: null });
    },
  };
  const documentObject = new FakeDocument();
  const controller = new ReaderV2Controller({ api, documentObject, resumeStore: store });
  await controller.openBook({ id: 'doc-1', name: 'Demo' });
  assert.deepEqual(calls, [0, 1]);
  assert.equal(controller.lastLocation.node_id, 'n2');
  assert.equal(controller.resumeRecord.node_id, 'n2');
  assert.equal(documentObject.querySelector('[data-reader-node-id="n2"]').scrolled, true);
});

test('deterministic playback frame restore seeks to the stored frame and remains paused', () => {
  const documentObject = new FakeDocument();
  const reader = {
    openResponse: identity(),
    nodes: [node('n1', 0)],
    resumeRecord: { frame_id: 'playback-frame:cand-1:n1:0001', node_id: 'n1', frame_ordinal: 1 },
    persistLocation() {},
    assetResolver: {},
  };
  const adapter = {
    buildPlaybackFrames() {
      return { frames: [
        { frame_id: 'playback-frame:cand-1:n1:0000', frame_ordinal: 0, kind: 'timed_text', text: 'a', duration_ms: 100, identity: identity({ node_id: 'n1' }) },
        { frame_id: 'playback-frame:cand-1:n1:0001', frame_ordinal: 1, kind: 'timed_text', text: 'b', duration_ms: 100, identity: identity({ node_id: 'n1' }) },
      ] };
    },
  };
  const controller = new ReaderSpeedPlaybackUIController({ documentObject, readerController: reader, adapter });
  controller.refreshFrames({ preserveIdentity: false });
  assert.equal(controller.restoreResumeFrame(), true);
  assert.equal(controller.playback.snapshot().index, 1);
  assert.equal(controller.playback.snapshot().state, 'paused');
});

test('resume modules exclude legacy Reader v1/blob/page progress dependencies', () => {
  const source = fs.readFileSync('reader-resume.js', 'utf8') + fs.readFileSync('reader-resume-lifecycle.js', 'utf8');
  for (const forbidden of ['/api/reader/v1', '/api/v1/books/', 'cachedContentBlob', 'state.content', 'tokenizeContent', 'page_id', 'presentation_id']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  const lifecycle = fs.readFileSync('reader-resume-lifecycle.js', 'utf8');
  assert.doesNotMatch(lifecycle, /prototype\.selectBook/);
  assert.match(lifecycle, /clearResume/);
});