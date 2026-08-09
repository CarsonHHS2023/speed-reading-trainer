const test = require('node:test');
const assert = require('node:assert/strict');

const Polish = require('../reader-playback-polish.js');

test('visible Play/Pause capture intercepts the legacy target listener before it can Stop', () => {
  let captureHandler = null;
  let toggleCalls = 0;
  let prevented = 0;
  let stopped = 0;
  let stoppedImmediate = 0;
  const toggle = { id: 'readingToggleBtn' };
  const controller = {
    document: {
      addEventListener(type, handler, capture) {
        assert.equal(type, 'click');
        assert.equal(capture, true);
        captureHandler = handler;
      },
    },
    isReaderActive: () => true,
    togglePause() { toggleCalls += 1; return true; },
  };

  assert.equal(Polish.bindReadingToggleCapture(controller), true);
  assert.equal(typeof captureHandler, 'function');
  captureHandler({
    target: toggle,
    preventDefault() { prevented += 1; },
    stopPropagation() { stopped += 1; },
    stopImmediatePropagation() { stoppedImmediate += 1; },
  });

  assert.equal(toggleCalls, 1);
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
  assert.equal(stoppedImmediate, 1);
});

test('Play/Pause while actively playing pauses through training state and never calls Stop', () => {
  let pauseCalls = 0;
  let stopCalls = 0;
  const controller = {
    isReaderActive: () => true,
    playback: {
      state: 'playing',
      frames: [{}, {}],
      stop() { stopCalls += 1; },
    },
    toggleTrainingPause() { pauseCalls += 1; return true; },
  };

  assert.equal(Polish.playPause(controller), true);
  assert.equal(pauseCalls, 1);
  assert.equal(stopCalls, 0);
});
