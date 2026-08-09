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

test('resolveResumeIndex finds exact frame id and falls back to node identity', () => {
  const frames = [
    { frame_id: 'f-1', frame_ordinal: 0, identity: { node_id: 'n-1' } },
    { frame_id: 'f-2', frame_ordinal: 1, identity: { node_id: 'n-2' } },
  ];

  assert.equal(Polish.resolveResumeIndex({
    reader: { resumeRecord: { frame_id: 'f-2' } },
    playback: { frames },
  }), 1);

  assert.equal(Polish.resolveResumeIndex({
    reader: { resumeRecord: { frame_id: 'missing', node_id: 'n-1', frame_ordinal: 0 } },
    playback: { frames },
  }), 0);
});

test('restoreResumeFrame defers seeking until playback starts', async () => {
  class Controller {
    constructor() {
      this.reader = { resumeRecord: { frame_id: 'manual-frame' } };
      this.playback = {
        frames: [
          { frame_id: 'text-frame', kind: 'timed' },
          { frame_id: 'manual-frame', kind: 'manual' },
        ],
        index: 0,
        play() { this.playedIndex = this.index; return true; },
      };
    }
    async start() { return this.playback.play(); }
    renderManualFrame() {}
  }

  assert.equal(Polish.install({ ReaderSpeedPlaybackUI: { ReaderSpeedPlaybackUIController: Controller } }), true);
  const controller = new Controller();

  assert.equal(controller.restoreResumeFrame(), true);
  assert.equal(controller.playback.index, 0, 'opening the book does not seek into the image');
  assert.equal(controller.pendingResumeFrameIndex, 1);

  assert.equal(await controller.start(), true);
  assert.equal(controller.playback.playedIndex, 1, 'resume position is applied only when playback starts');
  assert.equal(controller.pendingResumeFrameIndex, null);
});

test('terminal manual frame is labelled as the last frame and returns to reader view', () => {
  class Controller {
    constructor() {
      this.playback = { frames: [{ kind: 'manual' }], index: 0 };
      this.stopped = false;
    }
    async start() { return true; }
    stop() { this.stopped = true; }
    renderManualFrame(_frame, target) {
      target.button = { textContent: '继续', onclick: null };
    }
  }

  Polish.install({ ReaderSpeedPlaybackUI: { ReaderSpeedPlaybackUIController: Controller } });
  const controller = new Controller();
  const target = { querySelector: () => target.button };

  controller.renderManualFrame({ kind: 'manual' }, target);
  assert.equal(target.button.textContent, '最后一帧 · 返回阅读视图');
  target.button.onclick({ stopPropagation() {} });
  assert.equal(controller.stopped, true);
});

test('width percentage input is wide enough to display three digits', () => {
  const widthInput = fakeButton('widthInput');
  const controller = { element: (id) => id === 'widthInput' ? widthInput : null };
  assert.equal(Polish.widenWidthInput(controller), true);
  assert.equal(widthInput.style.width, '48px');
  assert.equal(widthInput.style.maxWidth, '48px');
  assert.equal(widthInput.style.minWidth, '48px');
});

test('toolbar upgrade adds first/last controls and distinguishes frame arrows from boundaries', () => {
  const prev = fakeButton('speedReadingPrev');
  const playPause = fakeButton('speedReadingPause');
  const next = fakeButton('speedReadingNext');
  const stop = fakeButton('speedReadingStop');
  const toolbar = fakeToolbar([prev, playPause, next, stop]);
  const byId = new Map([
    ['speedReadingV2Toolbar', toolbar],
    ['speedReadingPrev', prev],
    ['speedReadingPause', playPause],
    ['speedReadingNext', next],
    ['speedReadingStop', stop],
  ]);
  const created = [];
  const controller = {
    document: {
      createElement() {
        const button = fakeButton();
        created.push(button);
        return button;
      },
    },
    element(id) { return byId.get(id) || null; },
    firstFrame() {},
    lastFrame() {},
  };

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

test('paused frame navigation presents Play rather than Pause/Stop', () => {
  const toggle = fakeButton('readingToggleBtn');
  const hiddenPlayPause = fakeButton('speedReadingPause');
  const first = fakeButton('speedReadingFirst');
  const prev = fakeButton('speedReadingPrev');
  const next = fakeButton('speedReadingNext');
  const last = fakeButton('speedReadingLast');
  const byId = new Map([
    ['readingToggleBtn', toggle], ['speedReadingPause', hiddenPlayPause],
    ['speedReadingFirst', first], ['speedReadingPrev', prev],
    ['speedReadingNext', next], ['speedReadingLast', last],
  ]);
  const controller = {
    isReaderActive: () => true,
    element: (id) => byId.get(id) || null,
  };

  Polish.applyPlaybackControlState(controller, {
    state: 'paused', index: 3, frame_count: 10,
  });
  assert.equal(toggle.textContent, '▶');
  assert.equal(toggle.title, '播放速度阅读');
  assert.equal(toggle.classList.contains('active'), false);
  assert.equal(hiddenPlayPause.textContent, '▶');
  assert.equal(prev.disabled, false);
  assert.equal(next.disabled, false);
});

test('playing state presents Pause while a dedicated Stop remains separate', () => {
  const toggle = fakeButton('readingToggleBtn');
  const hiddenPlayPause = fakeButton('speedReadingPause');
  const controller = {
    isReaderActive: () => true,
    element(id) {
      if (id === 'readingToggleBtn') return toggle;
      if (id === 'speedReadingPause') return hiddenPlayPause;
      return null;
    },
  };
  Polish.applyPlaybackControlState(controller, {
    state: 'playing', index: 1, frame_count: 5,
  });
  assert.equal(toggle.textContent, '⏸');
  assert.equal(toggle.title, '暂停速度阅读');
  assert.equal(toggle.classList.contains('active'), true);
  assert.equal(hiddenPlayPause.textContent, '⏸');
});

test('play control resumes autoplay from a frame-navigation pause', () => {
  let resumeCalls = 0;
  let clockStartCalls = 0;
  const controller = {
    isReaderActive: () => true,
    trainingPaused: false,
    comprehensionPaused: false,
    resumePlaybackAfterTrainingPause: false,
    trainingClock: {
      state: 'idle',
      start() { this.state = 'running'; clockStartCalls += 1; },
    },
    startTrainingTicker() {},
    playback: {
      state: 'paused',
      frames: [{}, {}, {}],
      resume() { this.state = 'playing'; resumeCalls += 1; return true; },
    },
  };

  assert.equal(Polish.playPause(controller), true);
  assert.equal(resumeCalls, 1);
  assert.equal(controller.playback.state, 'playing');
  assert.equal(clockStartCalls, 1);
});

test('first/last navigation uses frame stepping semantics and does not continue autoplay', () => {
  const calls = [];
  const controller = {
    isReaderActive: () => true,
    playback: {
      snapshot: () => ({ state: 'paused', index: 4, frame_count: 10 }),
      moveBy(delta) { calls.push(delta); return delta; },
    },
  };
  assert.equal(Polish.moveToBoundary(controller, false), -4);
  assert.equal(Polish.moveToBoundary(controller, true), 5);
  assert.deepEqual(calls, [-4, 5]);
});