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

test('playback polish exports presentation concerns only', () => {
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
});

test('terminal manual frame is labelled as the last frame and returns to reader view', () => {
  class Controller {
    constructor() {
      this.playback = { frames: [{ kind: 'manual' }], index: 0 };
      this.stopped = false;
    }
    stop() { this.stopped = true; }
    renderManualFrame(_frame, target) {
      target.button = { textContent: '继续', onclick: null };
    }
    updateControls() {}
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

test('toolbar upgrade adds first/last controls without owning their transport semantics', () => {
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

test('ordinary Reader labels use pages while an engaged session uses frames', () => {
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
  assert.match(active.hint.textContent, /上一帧\/下一帧/);
});
