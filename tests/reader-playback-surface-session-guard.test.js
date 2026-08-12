const test = require('node:test');
const assert = require('node:assert/strict');

const { ReaderSpeedPlaybackUIController } = require('../reader-speed-playback-ui.js');

function fakeSurface() {
  return {
    active: false,
    classList: {
      add() { this.active = true; },
      remove() { this.active = false; },
      toggle(_name, force) { this.active = Boolean(force); },
    },
  };
}

function makeController({ playbackState = 'idle', clockState = 'idle' } = {}) {
  const reader = fakeSurface();
  const focus = fakeSurface();
  const page = fakeSurface();
  const chart = fakeSurface();
  const map = new Map([
    ['readerV2Display', reader],
    ['focusModeDisplay', focus],
    ['pageModeDisplay', page],
    ['chartDisplay', chart],
    ['focusText', {}],
    ['pageText', {}],
  ]);
  const controller = Object.create(ReaderSpeedPlaybackUIController.prototype);
  controller.playback = { state: playbackState };
  controller.trainingClock = { state: clockState };
  controller.document = {};
  controller.element = (id) => map.get(id) || null;
  controller.displayScope = () => 'line';
  controller.applyVisualSettings = () => {};
  controller.renderFrame = () => {};
  return { controller, focus, page, reader };
}

test('idle Reader cannot be switched to playback surface by layout reflow', () => {
  const { controller, focus, reader } = makeController({ playbackState: 'idle', clockState: 'idle' });
  const result = controller.showPlaybackSurface({ frame_id: 'already-built-frame' });

  assert.equal(result, false);
  assert.equal(reader.classList.active, true);
  assert.equal(focus.classList.active, false);
  assert.equal(controller.isPlaybackSessionEngaged(), false);
});

test('paused frame state without an active training clock remains in Reader', () => {
  const { controller, reader } = makeController({ playbackState: 'paused', clockState: 'stopped' });
  const result = controller.showPlaybackSurface({ frame_id: 'paused-frame' });

  assert.equal(result, false);
  assert.equal(reader.classList.active, true);
  assert.equal(controller.isPlaybackSessionEngaged(), false);
});

test('real playing, comprehension-paused, training-paused, and manual sessions may show playback', () => {
  for (const [playbackState, clockState] of [
    ['playing', 'running'],
    ['paused', 'running'],
    ['paused', 'paused'],
    ['manual', 'running'],
  ]) {
    const { controller, focus, reader } = makeController({ playbackState, clockState });
    const result = controller.showPlaybackSurface({ frame_id: `${playbackState}-${clockState}` });
    assert.equal(result, true);
    assert.equal(reader.classList.active, false);
    assert.equal(focus.classList.active, true);
    assert.equal(controller.isPlaybackSessionEngaged(), true);
  }
});
