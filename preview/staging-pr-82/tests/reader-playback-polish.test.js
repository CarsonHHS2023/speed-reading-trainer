const test = require('node:test');
const assert = require('node:assert/strict');

const Polish = require('../reader-playback-polish.js');

function fakeButton(id = '') {
  const listeners = new Map();
  const classes = new Set();
  return {
    id,
    type: 'button',
    textContent: '',
    title: '',
    disabled: false,
    style: {},
    dataset: {},
    attributes: {},
    parentNode: null,
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(type, handler) { listeners.set(type, handler); },
    dispatch(type, event = {}) { return listeners.get(type)?.(event); },
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      contains(name) { return classes.has(name); },
      toggle(name, force) {
        if (force === true) classes.add(name);
        else if (force === false) classes.delete(name);
        else if (classes.has(name)) classes.delete(name);
        else classes.add(name);
      },
    },
  };
}

function fakeToolbar(children = []) {
  const toolbar = fakeButton('speedReadingV2Toolbar');
  toolbar.children = [];
  toolbar.classList.contains = () => false;
  toolbar.appendChild = function appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  };
  toolbar.insertBefore = function insertBefore(child, reference) {
    child.parentNode = this;
    const index = this.children.indexOf(reference);
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  };
  toolbar.querySelector = () => null;
  children.forEach((child) => toolbar.appendChild(child));
  return toolbar;
}

function makeToolbarController({ engaged = false } = {}) {
  const prev = fakeButton('speedReadingPrev');
  const playPause = fakeButton('speedReadingPause');
  const next = fakeButton('speedReadingNext');
  const stop = fakeButton('speedReadingStop');
  const hint = { textContent: '' };
  const toolbar = fakeToolbar([prev, playPause, next, stop]);
  toolbar.querySelector = (selector) => selector === '.speed-reading-v2-shortcuts' ? hint : null;
  const byId = new Map([
    ['speedReadingV2Toolbar', toolbar],
    ['speedReadingPrev', prev],
    ['speedReadingPause', playPause],
    ['speedReadingNext', next],
    ['speedReadingStop', stop],
  ]);
  const created = [];
  const controller = {
    trainingClock: { state: engaged ? 'running' : 'idle' },
    playback: { state: engaged ? 'playing' : 'idle' },
    document: {
      createElement() {
        const button = fakeButton();
        created.push(button);
        byId.set(button.id, button);
        return button;
      },
    },
    element(id) {
      if (id === 'speedReadingFirst') return toolbar.children.find((item) => item.id === id) || null;
      if (id === 'speedReadingLast') return toolbar.children.find((item) => item.id === id) || null;
      return byId.get(id) || null;
    },
    firstFrame() {},
    lastFrame() {},
    isPlaybackSessionEngaged() { return engaged; },
  };
  return { controller, created, hint, next, prev, toolbar };
}

test('playback polish exports transport/window and presentation helpers without reviving legacy core owners', () => {
  for (const removedCoreOwner of [
    'resolveResumeIndex',
    'playPause',
    'togglePlayPause',
    'navigateBy',
    'moveToBoundary',
    'continueManualRespectingSession',
    'applyPlaybackControlState',
    'wrapPlaybackSurface',
  ]) {
    assert.equal(Polish[removedCoreOwner], undefined, removedCoreOwner);
  }
  assert.equal(typeof Polish.upgradeToolbar, 'function');
  assert.equal(typeof Polish.applyTransportLabels, 'function');
  assert.equal(typeof Polish.widenWidthInput, 'function');
  assert.equal(typeof Polish.repackPageFrames, 'function');
  assert.equal(typeof Polish.extendPlaybackWindow, 'function');
});

test('terminal manual frame is labelled as the last frame and returns to reader view', () => {
  class Controller {
    constructor() {
      this.playback = {
        frames: [{ kind: 'manual' }],
        index: 0,
        state: 'manual',
        snapshot() { return { state: this.state, index: this.index, frame_count: this.frames.length }; },
      };
      this.reader = { windowRecord: () => ({ start: 0, hasMore: false }) };
      this.activeBatchStart = 0;
      this.trainingClock = { state: 'running' };
      this.stopped = false;
    }
    stop() { this.stopped = true; }
    renderManualFrame(_frame, target) {
      target.button = { textContent: '继续', onclick: null };
    }
    updateControls() {}
    isPlaybackSessionEngaged() { return true; }
  }

  Polish.install({ ReaderSpeedPlaybackUI: { ReaderSpeedPlaybackUIController: Controller } });
  const controller = new Controller();
  const target = { querySelector: () => target.button };

  controller.renderManualFrame({ kind: 'manual' }, target);
  assert.equal(target.button.textContent, '最后一帧 · 返回阅读视图');
  target.button.onclick({ stopPropagation() {} });
  assert.equal(controller.stopped, true);
});

test('a loaded batch tail is not labelled as the document tail when another node window exists', () => {
  class Controller {
    constructor() {
      this.playback = {
        frames: [{ kind: 'manual' }],
        index: 0,
        state: 'manual',
        snapshot() { return { state: this.state, index: 0, frame_count: 1 }; },
      };
      this.reader = { windowRecord: () => ({ start: 0, hasMore: true }) };
      this.activeBatchStart = 0;
      this.trainingClock = { state: 'running' };
    }
    renderManualFrame(_frame, target) { target.button = { textContent: '', onclick: null }; }
    updateControls() {}
    isPlaybackSessionEngaged() { return true; }
  }
  Polish.install({ ReaderSpeedPlaybackUI: { ReaderSpeedPlaybackUIController: Controller } });
  const controller = new Controller();
  const target = { querySelector: () => target.button };
  controller.renderManualFrame({ kind: 'manual' }, target);
  assert.equal(target.button.textContent, '继续');
});

test('width percentage input is wide enough to display three digits', () => {
  const widthInput = fakeButton('widthInput');
  const controller = { element: (id) => id === 'widthInput' ? widthInput : null };
  assert.equal(Polish.widenWidthInput(controller), true);
  assert.equal(widthInput.style.width, '48px');
  assert.equal(widthInput.style.maxWidth, '48px');
  assert.equal(widthInput.style.minWidth, '48px');
});

test('toolbar upgrade adds first/last controls without owning ordinary Reader page semantics', () => {
  const { controller, created, next, prev, toolbar } = makeToolbarController();

  assert.equal(Polish.upgradeToolbar(controller), true);
  assert.deepEqual(toolbar.children.map((item) => item.id), [
    'speedReadingFirst', 'speedReadingPrev', 'speedReadingPause',
    'speedReadingNext', 'speedReadingLast', 'speedReadingStop',
  ]);
  assert.equal(prev.textContent, '←');
  assert.equal(next.textContent, '→');
  assert.equal(toolbar.children[0].textContent, '⏮');
  assert.equal(toolbar.children[4].textContent, '⏭');
  assert.equal(created.length, 2);
});

test('ordinary Reader labels use pages while an engaged session uses document-wide frames', () => {
  const ordinary = makeToolbarController({ engaged: false });
  Polish.upgradeToolbar(ordinary.controller);
  Polish.applyTransportLabels(ordinary.controller);
  assert.equal(ordinary.prev.title, '上一页');
  assert.equal(ordinary.next.title, '下一页');
  assert.match(ordinary.hint.textContent, /上一页\/下一页/);

  const active = makeToolbarController({ engaged: true });
  Polish.upgradeToolbar(active.controller);
  Polish.applyTransportLabels(active.controller);
  assert.equal(active.prev.title, '上一帧');
  assert.equal(active.next.title, '下一帧');
  assert.match(active.hint.textContent, /整本书第一帧\/最后一帧/);
});

test('Page repacking carries rows across semantic run boundaries instead of emitting an avoidable two-line frame', () => {
  const controller = {
    adapter: { frameDurationMs: (units) => units * 10 },
    element: (id) => id === 'speedInput' ? { value: '600' } : null,
  };
  const row = (text, nodeId) => ({
    text,
    node_type: 'paragraph',
    row_height_px: 30,
    paragraph_gap_before_px: 0,
    reading_units: 1,
    identity: { candidate_id: 'c', node_id: nodeId },
    source_spans: [{ candidate_id: 'c', node_id: nodeId }],
  });
  const frame = (id, lines) => ({
    frame_id: id,
    kind: 'timed_text',
    lines,
    identity: lines[0].identity,
    source_spans: lines.flatMap((line) => line.source_spans),
    placement: { display_scope: 'page', page_height_px: 100, row_gap_px: 5, virtual_page_index: 0 },
  });
  const packed = Polish.repackPageFrames(controller, [
    frame('f1', [row('a', 'n1'), row('b', 'n2')]),
    frame('f2', [row('chapter', 'n3')]),
    frame('f3', [row('c', 'n4'), row('d', 'n5')]),
  ]);
  assert.deepEqual(packed.map((item) => item.lines.length), [3, 2]);
  assert.equal(packed[0].text, 'a\nb\nchapter');
});

test('near a loaded tail, the next 150-node window is converted and appended without rebuilding the Reader surface', async () => {
  const records = new Map([
    [0, { start: 0, nodes: [{ node_id: 'n0' }], hasMore: true, nextNodeOrder: 150 }],
    [150, { start: 150, nodes: [{ node_id: 'n150' }], hasMore: false, nextNodeOrder: null }],
  ]);
  const requests = [];
  const reader = {
    windowRecord: (start) => records.get(start) || null,
    async requestWindow(start) { requests.push(start); return records.get(start) || null; },
  };
  const playback = {
    frames: [{ frame_id: 'f0', identity: { node_id: 'n0' } }],
    index: 0,
    currentFrame() { return this.frames[this.index]; },
    setFrames(frames) { this.frames = frames; },
  };
  const controller = {
    reader,
    playback,
    activeBatchStart: 0,
    buildFrames(context) {
      return { frames: context.nodes.map((node) => ({ frame_id: `f-${node.node_id}`, identity: { node_id: node.node_id } })) };
    },
  };
  Polish.playbackWindowStarts(controller).add(0);
  const extended = await Polish.extendPlaybackWindow(controller, 1);
  assert.equal(extended, true);
  assert.deepEqual(requests, [150]);
  assert.deepEqual(playback.frames.map((item) => item.identity.node_id), ['n0', 'n150']);
  assert.deepEqual([...Polish.playbackWindowStarts(controller)].sort((a, b) => a - b), [0, 150]);
});

test('document transport remains enabled at a loaded batch edge when another window exists', () => {
  const first = fakeButton('speedReadingFirst');
  const prev = fakeButton('speedReadingPrev');
  const next = fakeButton('speedReadingNext');
  const last = fakeButton('speedReadingLast');
  const buttons = new Map([[first.id, first], [prev.id, prev], [next.id, next], [last.id, last]]);
  const controller = {
    activeBatchStart: 150,
    trainingClock: { state: 'running' },
    playback: {
      state: 'playing',
      snapshot: () => ({ state: 'playing', index: 0, frame_count: 1 }),
    },
    reader: { windowRecord: (start) => ({ start, hasMore: start === 150 }) },
    element: (id) => buttons.get(id) || null,
    isPlaybackSessionEngaged: () => true,
  };
  Polish.playbackWindowStarts(controller).add(150);
  Polish.applyDocumentTransportState(controller);
  assert.equal(first.disabled, false);
  assert.equal(prev.disabled, false);
  assert.equal(next.disabled, false);
  assert.equal(last.disabled, false);
});

test('End scans node windows without converting intermediate batches and resolves the real document tail', async () => {
  const calls = [];
  const records = {
    150: { start: 150, nodes: [{ node_id: 'n150' }], hasMore: true, nextNodeOrder: 300 },
    300: { start: 300, nodes: [{ node_id: 'n300' }], hasMore: true, nextNodeOrder: 450 },
    450: { start: 450, nodes: [{ node_id: 'n450' }], hasMore: false, nextNodeOrder: null },
  };
  const cached = new Map([[150, records[150]]]);
  const controller = {
    activeBatchStart: 150,
    reader: {
      windowRecord: (start) => cached.get(start) || null,
      async requestWindow(start, options = {}) {
        calls.push([start, options.cache]);
        const record = records[start] || null;
        if (record && options.cache !== false) cached.set(start, record);
        return record;
      },
    },
  };
  Polish.playbackWindowStarts(controller).add(150);
  const tail = await Polish.findLastWindow(controller);
  assert.equal(tail.start, 450);
  assert.deepEqual(calls, [[150, undefined], [300, false], [450, false], [450, undefined]]);
});