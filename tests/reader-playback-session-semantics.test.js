const test = require('node:test');
const assert = require('node:assert/strict');

const Polish = require('../reader-playback-polish.js');

function button() {
  const classes = new Set();
  return {
    textContent: '',
    title: '',
    disabled: false,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); },
    },
  };
}

test('frame navigation interrupts active playback and pauses the training clock', () => {
  const calls = [];
  const controller = {
    trainingPaused: false,
    comprehensionPaused: true,
    resumePlaybackAfterTrainingPause: false,
    trainingClock: {
      state: 'running',
      pause() { this.state = 'paused'; calls.push('clock.pause'); return true; },
    },
    playback: {
      state: 'playing',
      pause() { this.state = 'paused'; calls.push('playback.pause'); return true; },
    },
    updateTrainingTime() { calls.push('time.update'); },
  };

  assert.equal(Polish.pauseForFrameNavigation(controller), true);
  assert.equal(controller.trainingPaused, true);
  assert.equal(controller.comprehensionPaused, false);
  assert.equal(controller.resumePlaybackAfterTrainingPause, true);
  assert.equal(controller.trainingClock.state, 'paused');
  assert.equal(controller.playback.state, 'paused');
  assert.deepEqual(calls, ['clock.pause', 'playback.pause', 'time.update']);
});

test('frame navigation while already paused does not change the training state', () => {
  let clockPauseCalls = 0;
  const controller = {
    trainingPaused: false,
    comprehensionPaused: false,
    resumePlaybackAfterTrainingPause: false,
    trainingClock: {
      state: 'running',
      pause() { clockPauseCalls += 1; },
    },
    playback: { state: 'paused', pause() { throw new Error('must not pause again'); } },
  };

  assert.equal(Polish.pauseForFrameNavigation(controller), false);
  assert.equal(clockPauseCalls, 0);
  assert.equal(controller.trainingPaused, false);
  assert.equal(controller.resumePlaybackAfterTrainingPause, false);
});

test('natural manual visual keeps the central control on Pause while the training clock runs', () => {
  const toggle = button();
  const hidden = button();
  const controller = {
    trainingPaused: false,
    trainingClock: { state: 'running' },
    isReaderActive: () => true,
    element(id) {
      if (id === 'readingToggleBtn') return toggle;
      if (id === 'speedReadingPause') return hidden;
      return null;
    },
  };

  Polish.applyPlaybackControlState(controller, {
    state: 'manual',
    index: 2,
    frame_count: 6,
  });

  assert.equal(toggle.textContent, '⏸');
  assert.equal(toggle.title, '暂停速度阅读');
  assert.equal(hidden.textContent, '⏸');
});

test('manual visual becomes Play only when the training session itself is paused', () => {
  const toggle = button();
  const controller = {
    trainingPaused: true,
    trainingClock: { state: 'paused' },
    isReaderActive: () => true,
    element(id) { return id === 'readingToggleBtn' ? toggle : null; },
  };

  Polish.applyPlaybackControlState(controller, {
    state: 'manual',
    index: 2,
    frame_count: 6,
  });

  assert.equal(toggle.textContent, '▶');
  assert.equal(toggle.title, '播放速度阅读');
});

test('central control on a manual visual pauses training instead of advancing the visual', () => {
  let toggleTrainingPauseCalls = 0;
  let continueManualCalls = 0;
  const controller = {
    isReaderActive: () => true,
    playback: { state: 'manual', frames: [{}] },
    toggleTrainingPause() { toggleTrainingPauseCalls += 1; return true; },
    continueManual() { continueManualCalls += 1; return true; },
  };

  assert.equal(Polish.playPause(controller), true);
  assert.equal(toggleTrainingPauseCalls, 1);
  assert.equal(continueManualCalls, 0);
});

test('installed previous/next controls pause an active training session before moving frames', () => {
  class Controller {
    constructor() {
      this.trainingPaused = false;
      this.comprehensionPaused = false;
      this.resumePlaybackAfterTrainingPause = false;
      this.trainingClock = {
        state: 'running',
        pause: () => { this.trainingClock.state = 'paused'; },
      };
      this.playback = {
        state: 'playing',
        pause: () => { this.playback.state = 'paused'; return true; },
      };
      this.previousCalls = 0;
      this.nextCalls = 0;
    }
    async start() { return true; }
    renderManualFrame() {}
    previousFrame() { this.previousCalls += 1; return 'prev'; }
    nextFrame() { this.nextCalls += 1; return 'next'; }
    updateControls() {}
    isReaderActive() { return true; }
  }

  assert.equal(Polish.install({ ReaderSpeedPlaybackUI: { ReaderSpeedPlaybackUIController: Controller } }), true);
  const previous = new Controller();
  assert.equal(previous.previousFrame(), 'prev');
  assert.equal(previous.trainingPaused, true);
  assert.equal(previous.trainingClock.state, 'paused');
  assert.equal(previous.playback.state, 'paused');
  assert.equal(previous.previousCalls, 1);

  const next = new Controller();
  assert.equal(next.nextFrame(), 'next');
  assert.equal(next.trainingPaused, true);
  assert.equal(next.trainingClock.state, 'paused');
  assert.equal(next.playback.state, 'paused');
  assert.equal(next.nextCalls, 1);
});
