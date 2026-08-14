const test = require('node:test');
const assert = require('node:assert/strict');

const { ReaderSpeedPlaybackUIController } = require('../reader-speed-playback-ui.js');

function button() {
  return {
    listeners: [],
    dataset: {},
    style: { setProperty() {} },
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(type, handler, options) { this.listeners.push({ type, handler, options }); },
    setAttribute() {},
  };
}

test('visible Play/Pause uses an authoritative capture listener before legacy target handlers', () => {
  const toggle = button();
  const documentObject = {
    body: { dataset: { readerV2Active: '1' } },
    head: { appendChild() {} },
    getElementById(id) { return id === 'readingToggleBtn' ? toggle : null; },
    querySelector() { return null; },
    addEventListener() {},
  };
  const controller = Object.create(ReaderSpeedPlaybackUIController.prototype);
  controller.document = documentObject;
  controller.reader = { openResponse: { candidate_id: 'cand' } };
  controller.bound = false;
  controller.ensureStylesheet = () => {};
  controller.configureModeControls = () => {};
  controller.ensureToolbar = () => {};
  controller.applyVisualSettings = () => {};
  controller.updateControls = () => {};
  let toggleCalls = 0;
  controller.togglePause = () => { toggleCalls += 1; return true; };

  controller.bind();
  const listener = toggle.listeners.find((item) => item.type === 'click');
  assert.ok(listener);
  assert.equal(listener.options, true, 'central Play/Pause must bind in capture phase');

  let prevented = 0;
  let stoppedImmediate = 0;
  listener.handler({
    preventDefault() { prevented += 1; },
    stopImmediatePropagation() { stoppedImmediate += 1; },
  });
  assert.equal(toggleCalls, 1);
  assert.equal(prevented, 1);
  assert.equal(stoppedImmediate, 1);
});

test('central control while an active speed session is playing delegates to training pause, never Stop', () => {
  const controller = Object.create(ReaderSpeedPlaybackUIController.prototype);
  controller.document = { body: { dataset: { readerV2Active: '1' } } };
  controller.reader = { openResponse: { candidate_id: 'cand' } };
  controller.trainingPaused = false;
  controller.trainingClock = { state: 'running' };
  controller.playback = { state: 'playing' };
  let pauseCalls = 0;
  let stopCalls = 0;
  controller.toggleTrainingPause = () => { pauseCalls += 1; return true; };
  controller.stop = () => { stopCalls += 1; };

  assert.equal(controller.togglePause(), true);
  assert.equal(pauseCalls, 1);
  assert.equal(stopCalls, 0);
});
