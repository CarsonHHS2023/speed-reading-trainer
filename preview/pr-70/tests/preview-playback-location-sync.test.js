const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'preview-runtime.js'), 'utf8');

function makeButton(id) {
  return {
    id,
    disabled: false,
    closest(selector) {
      return selector.includes(`#${id}`) || selector.includes(id) ? this : null;
    },
  };
}

function makeTarget() {
  return {
    scrollCount: 0,
    focusCount: 0,
    scrollIntoView() { this.scrollCount += 1; },
    focus() { this.focusCount += 1; },
  };
}

function buildHarness() {
  const listeners = {};
  const targets = {
    start: makeTarget(),
    middle: makeTarget(),
    'chapter-20': makeTarget(),
    after: makeTarget(),
  };
  const first = makeButton('speedReadingFirst');
  const prev = makeButton('speedReadingPrev');
  const next = makeButton('speedReadingNext');
  const last = makeButton('speedReadingLast');
  const buttons = { first, prev, next, last };
  const main = {
    dataset: {},
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 0,
    addEventListener() {},
  };

  const documentObject = {
    readyState: 'complete',
    body: { dataset: { readerV2Active: '1' } },
    activeElement: null,
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    querySelector(selector) {
      if (selector === '.reader-v2-main') return main;
      const match = String(selector).match(/data-reader-node-id=\"([^\"]+)\"/);
      return match ? targets[match[1]] || null : null;
    },
  };

  class FakeReaderController {
    constructor() {
      this.document = documentObject;
      this.documentRef = 'doc-1';
      this.candidateId = 'candidate-1';
      this.openResponse = { candidate_id: 'candidate-1' };
      this.nodes = [
        { node_id: 'start', location: { node_id: 'start' } },
        { node_id: 'middle', location: { node_id: 'middle' } },
        { node_id: 'chapter-20', location: { node_id: 'chapter-20' } },
        { node_id: 'after', location: { node_id: 'after' } },
      ];
      this.hasMore = false;
      this.presentationState = { mode: 'reflow', pages: [] };
      this.model = {
        findNodeById: (nodes, nodeId) => nodes.find((node) => node.node_id === nodeId) || null,
      };
      this.persisted = [];
    }

    async loadMore() { return null; }
    element() { return null; }
    setStatus() {}
    renderError(error) { throw error; }
    locationForNode(nodeId) {
      return this.model.findNodeById(this.nodes, nodeId)?.location || null;
    }
    persistLocation(location, extra = {}) {
      this.lastLocation = location;
      this.persisted.push({ location, extra });
      return { ...location, ...extra };
    }
  }

  let reader = null;
  let speed = null;

  class FakeSpeedController {
    constructor() {
      this.reader = reader;
      this.adapter = { buildPlaybackFrames() { return { frames: [] }; } };
      this.trainingClock = { state: 'idle' };
      this.refreshCalls = 0;
      this.pendingResumeFrameIndex = null;
      this.playback = {
        state: 'idle',
        index: 0,
        frames: [
          { frame_id: 'f-start', frame_ordinal: 0, identity: { node_id: 'start' } },
        ],
        snapshot: () => ({
          state: this.playback.state,
          index: this.playback.index,
          frame_count: this.playback.frames.length,
          frame: this.playback.frames[this.playback.index] || null,
        }),
        seek: (progress, options = {}) => {
          const count = this.playback.frames.length;
          this.playback.index = count
            ? Math.min(count - 1, Math.floor(Math.max(0, Math.min(1, Number(progress) || 0)) * count))
            : 0;
          this.playback.state = options.activate === false ? 'idle' : 'paused';
          this.updateControls();
          return this.playback.frames[this.playback.index] || null;
        },
        moveBy: (delta) => {
          this.playback.index = Math.max(
            0,
            Math.min(this.playback.frames.length - 1, this.playback.index + Number(delta || 0)),
          );
          this.playback.state = 'paused';
          this.updateControls();
          return this.playback.frames[this.playback.index] || null;
        },
      };
    }

    element(id) {
      if (id === 'speedReadingFirst') return first;
      if (id === 'speedReadingPrev') return prev;
      if (id === 'speedReadingNext') return next;
      if (id === 'speedReadingLast') return last;
      return null;
    }

    isReaderActive() { return true; }
    refreshFrames(options) {
      this.refreshCalls += 1;
      assert.equal(options.preserveIdentity, false);
      this.playback.frames = [
        { frame_id: 'f-start', frame_ordinal: 0, identity: { node_id: 'start' } },
        { frame_id: 'f-middle', frame_ordinal: 1, identity: { node_id: 'middle' } },
        { frame_id: 'f-chapter-20', frame_ordinal: 2, identity: { node_id: 'chapter-20' } },
        { frame_id: 'f-after', frame_ordinal: 3, identity: { node_id: 'after' } },
      ];
      this.playback.index = 0;
      this.playback.state = 'idle';
      this.updateControls();
      return this.playback.frames;
    }
    updateControls() {
      const snapshot = this.playback.snapshot();
      first.disabled = snapshot.index <= 0;
      prev.disabled = snapshot.index <= 0;
      next.disabled = snapshot.index >= snapshot.frame_count - 1;
      last.disabled = snapshot.index >= snapshot.frame_count - 1;
    }
  }

  reader = new FakeReaderController();
  speed = new FakeSpeedController();
  speed.reader = reader;
  speed.updateControls();

  const windowObject = {
    location: {
      pathname: '/speed-reading-trainer/preview/pr-70/',
      href: 'https://carsonhhs2023.github.io/speed-reading-trainer/preview/pr-70/',
    },
    fetch: async () => ({ ok: true }),
    Request: global.Request,
    document: documentObject,
    ReaderUIV2: {
      ReaderV2Controller: FakeReaderController,
      getDefaultController: () => reader,
    },
    ReaderSpeedPlaybackUI: {
      ReaderSpeedPlaybackUIController: FakeSpeedController,
      getDefaultController: () => speed,
    },
    requestAnimationFrame(callback) { callback(); },
    console: { info() {} },
  };
  const context = vm.createContext({
    window: windowObject,
    URL,
    Request: global.Request,
    console: windowObject.console,
  });
  vm.runInContext(runtimeSource, context, { filename: 'preview-runtime.js' });

  return { reader, speed, buttons, targets, listeners };
}

function dispatchClick(listener, target) {
  let stopped = false;
  listener({
    target,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() { stopped = true; },
  });
  return stopped;
}

test('explicit TOC navigation aligns idle playback cursor with the Reader semantic node', async () => {
  const { reader, speed, buttons, targets } = buildHarness();

  assert.equal(speed.playback.index, 0);
  assert.equal(buttons.first.disabled, true);
  assert.equal(buttons.prev.disabled, true);

  const navigated = await reader.navigateTo({ node_id: 'chapter-20' }, { userInitiated: true });

  assert.equal(navigated, true);
  assert.equal(targets['chapter-20'].scrollCount, 1);
  assert.equal(speed.refreshCalls, 1);
  assert.equal(speed.playback.index, 2);
  assert.equal(speed.playback.state, 'idle');
  assert.equal(buttons.first.disabled, false);
  assert.equal(buttons.prev.disabled, false);
  assert.equal(reader.lastLocation.node_id, 'chapter-20');
});

test('idle transport browsing keeps playback idle and moves the Reader with the selected frame', async () => {
  const { reader, speed, buttons, targets, listeners } = buildHarness();
  await reader.navigateTo({ node_id: 'chapter-20' }, { userInitiated: true });

  assert.equal(typeof listeners.click, 'function');
  assert.equal(dispatchClick(listeners.click, buttons.prev), true);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(speed.playback.index, 1);
  assert.equal(speed.playback.state, 'idle');
  assert.equal(targets.middle.scrollCount, 1);
  assert.equal(reader.lastLocation.node_id, 'middle');
  assert.equal(reader.persisted.at(-1).extra.frameId, 'f-middle');
  assert.equal(reader.persisted.at(-1).extra.frameOrdinal, 1);

  assert.equal(dispatchClick(listeners.click, buttons.first), true);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(speed.playback.index, 0);
  assert.equal(speed.playback.state, 'idle');
  assert.equal(targets.start.scrollCount, 1);
  assert.equal(buttons.first.disabled, true);
  assert.equal(buttons.prev.disabled, true);
});
