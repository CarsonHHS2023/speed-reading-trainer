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

function activeController(options = {}) {
  const calls = [];
  const controller = {
    trainingPaused: Boolean(options.trainingPaused),
    comprehensionPaused: Boolean(options.comprehensionPaused),
    resumePlaybackAfterTrainingPause: Boolean(options.resumePlaybackAfterTrainingPause),
    trainingClock: {
      state: options.clockState || 'running',
      pause() {
        if (this.state !== 'running') return false;
        this.state = 'paused';
        calls.push('clock.pause');
        return true;
      },
      resume() {
        if (this.state !== 'paused') return false;
        this.state = 'running';
        calls.push('clock.resume');
        return true;
      },
    },
    playback: {
      state: options.playbackState || 'playing',
      frames: options.frames || [{}, {}, {}],
      index: options.index || 0,
      pause() {
        if (this.state !== 'playing') return false;
        this.state = 'paused';
        calls.push('playback.pause');
        return true;
      },
      moveBy(delta) {
        this.index = Math.max(0, Math.min(this.frames.length - 1, this.index + delta));
        this.state = options.targetManual ? 'manual' : 'paused';
        calls.push(`moveBy:${delta}`);
        return this.frames[this.index];
      },
      next() {
        calls.push('playback.next');
        this.index = Math.min(this.frames.length - 1, this.index + 1);
        this.state = options.nextManual ? 'manual' : 'paused';
        return this.frames[this.index];
      },
      continueManual() {
        calls.push('playback.continueManual');
        this.index = Math.min(this.frames.length - 1, this.index + 1);
        this.state = 'playing';
        return true;
      },
      snapshot() {
        return { state: this.state, index: this.index, frame_count: this.frames.length, frame: this.frames[this.index] };
      },
    },
    isReaderActive: () => true,
    updateTrainingTime() { calls.push('time.update'); },
    updateControls() { calls.push('controls.update'); },
  };
  controller.calls = calls;
  return controller;
}

test('frame navigation from an active session pauses clock and autoplay before moving', () => {
  const controller = activeController({ playbackState: 'playing', clockState: 'running' });

  const frame = Polish.navigateBy(controller, 1);

  assert.ok(frame);
  assert.equal(controller.trainingPaused, true);
  assert.equal(controller.comprehensionPaused, false);
  assert.equal(controller.resumePlaybackAfterTrainingPause, true);
  assert.equal(controller.trainingClock.state, 'paused');
  assert.equal(controller.playback.state, 'paused');
  assert.deepEqual(controller.calls, ['clock.pause', 'playback.pause', 'moveBy:1']);
});

test('frame navigation from a natural manual wait also pauses the running clock before moving', () => {
  const controller = activeController({ playbackState: 'manual', clockState: 'running', index: 1 });

  Polish.navigateBy(controller, 1);

  assert.equal(controller.trainingPaused, true);
  assert.equal(controller.trainingClock.state, 'paused');
  assert.equal(controller.playback.index, 2);
  assert.equal(controller.playback.state, 'paused');
  assert.deepEqual(controller.calls, ['clock.pause', 'time.update', 'controls.update', 'moveBy:1']);
});

test('frame navigation while the training clock is already paused does not restart or re-pause it', () => {
  const controller = activeController({
    playbackState: 'paused',
    clockState: 'paused',
    trainingPaused: true,
    resumePlaybackAfterTrainingPause: true,
  });

  Polish.navigateBy(controller, 1);

  assert.equal(controller.trainingClock.state, 'paused');
  assert.equal(controller.trainingPaused, true);
  assert.deepEqual(controller.calls, ['moveBy:1']);
});

test('stopped browsing on a manual visual advances one frame without starting autoplay or the clock', () => {
  const controller = activeController({ playbackState: 'manual', clockState: 'stopped', index: 1 });

  assert.equal(Polish.continueManualRespectingSession(controller), true);
  assert.equal(controller.playback.index, 2);
  assert.equal(controller.playback.state, 'paused');
  assert.equal(controller.trainingClock.state, 'stopped');
  assert.deepEqual(controller.calls, ['playback.next']);
});

test('paused browsing on a manual visual advances one frame without resuming autoplay', () => {
  const controller = activeController({
    playbackState: 'manual',
    clockState: 'paused',
    trainingPaused: true,
    index: 1,
  });

  assert.equal(Polish.continueManualRespectingSession(controller), true);
  assert.equal(controller.playback.index, 2);
  assert.equal(controller.playback.state, 'paused');
  assert.equal(controller.trainingClock.state, 'paused');
  assert.deepEqual(controller.calls, ['playback.next']);
});

test('natural manual visual Continue resumes autoplay only while the training session is running', () => {
  const controller = activeController({ playbackState: 'manual', clockState: 'running', index: 1 });

  assert.equal(Polish.continueManualRespectingSession(controller), true);
  assert.equal(controller.playback.index, 2);
  assert.equal(controller.playback.state, 'playing');
  assert.equal(controller.trainingClock.state, 'running');
  assert.deepEqual(controller.calls, ['playback.continueManual']);
});

test('manual visual shows Pause while training runs and Play while browsing is paused', () => {
  const toggle = button();
  const hidden = button();
  const controller = activeController({ playbackState: 'manual', clockState: 'running' });
  controller.element = (id) => {
    if (id === 'readingToggleBtn') return toggle;
    if (id === 'speedReadingPause') return hidden;
    return null;
  };

  Polish.applyPlaybackControlState(controller, { state: 'manual', index: 1, frame_count: 3 });
  assert.equal(toggle.textContent, '⏸');
  assert.equal(hidden.textContent, '⏸');

  controller.trainingClock.state = 'paused';
  controller.trainingPaused = true;
  Polish.applyPlaybackControlState(controller, { state: 'manual', index: 1, frame_count: 3 });
  assert.equal(toggle.textContent, '▶');
  assert.equal(hidden.textContent, '▶');
});

test('central control on a running manual visual pauses training instead of advancing the visual', () => {
  let toggleTrainingPauseCalls = 0;
  let continueManualCalls = 0;
  const controller = {
    isReaderActive: () => true,
    trainingClock: { state: 'running' },
    playback: { state: 'manual', frames: [{}] },
    toggleTrainingPause() { toggleTrainingPauseCalls += 1; return true; },
    continueManual() { continueManualCalls += 1; return true; },
  };

  assert.equal(Polish.togglePlayPause(controller), true);
  assert.equal(toggleTrainingPauseCalls, 1);
  assert.equal(continueManualCalls, 0);
});
