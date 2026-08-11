const test = require('node:test');
const assert = require('node:assert/strict');

const { ReaderSpeedPlaybackUIController } = require('../reader-speed-playback-ui.js');

function makeController(options = {}) {
  const calls = [];
  const controller = Object.create(ReaderSpeedPlaybackUIController.prototype);
  controller.document = { body: { dataset: { readerV2Active: '1' } } };
  controller.reader = {
    openResponse: { candidate_id: 'cand' },
    previousPage() { calls.push('reader.previousPage'); return true; },
    nextPage() { calls.push('reader.nextPage'); return true; },
    firstPage() { calls.push('reader.firstPage'); return true; },
    lastPage() { calls.push('reader.lastPage'); return true; },
    renderError() {},
  };
  controller.trainingPaused = Boolean(options.trainingPaused);
  controller.comprehensionPaused = Boolean(options.comprehensionPaused);
  controller.resumePlaybackAfterTrainingPause = Boolean(options.resumePlaybackAfterTrainingPause);
  controller.trainingClock = {
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
    start() { this.state = 'running'; calls.push('clock.start'); },
    stop() { this.state = 'stopped'; calls.push('clock.stop'); },
  };
  const frames = options.frames || [{ frame_id: 'f0' }, { frame_id: 'f1' }, { frame_id: 'f2' }];
  controller.playback = {
    state: options.playbackState || 'playing',
    frames,
    index: options.index || 0,
    pause() {
      if (this.state !== 'playing') return false;
      this.state = 'paused';
      calls.push('playback.pause');
      return true;
    },
    resume() {
      if (this.state !== 'paused') return false;
      this.state = 'playing';
      calls.push('playback.resume');
      return true;
    },
    moveBy(delta) {
      this.index = Math.max(0, Math.min(this.frames.length - 1, this.index + delta));
      this.state = 'paused';
      calls.push(`moveBy:${delta}`);
      return this.frames[this.index];
    },
    snapshot() {
      return { state: this.state, index: this.index, frame_count: this.frames.length, frame: this.frames[this.index] };
    },
    continueManual() { calls.push('playback.continueManual'); return true; },
  };
  controller.updateTrainingTime = () => calls.push('time.update');
  controller.updateControls = () => calls.push('controls.update');
  controller.startTrainingTicker = () => calls.push('ticker.start');
  controller.calls = calls;
  return controller;
}

test('frame navigation pauses a running training session before moving', () => {
  const controller = makeController({ playbackState: 'playing', clockState: 'running' });
  const frame = controller.navigateFrameBy(1);

  assert.ok(frame);
  assert.equal(controller.trainingPaused, true);
  assert.equal(controller.comprehensionPaused, false);
  assert.equal(controller.resumePlaybackAfterTrainingPause, true);
  assert.equal(controller.trainingClock.state, 'paused');
  assert.equal(controller.playback.state, 'paused');
  assert.deepEqual(controller.calls, ['clock.pause', 'playback.pause', 'moveBy:1']);
});

test('manual-frame navigation pauses the running clock and then moves exactly one frame', () => {
  const controller = makeController({ playbackState: 'manual', clockState: 'running', index: 1 });
  controller.navigateFrameBy(1);

  assert.equal(controller.trainingPaused, true);
  assert.equal(controller.trainingClock.state, 'paused');
  assert.equal(controller.playback.index, 2);
  assert.equal(controller.playback.state, 'paused');
  assert.equal(controller.resumePlaybackAfterTrainingPause, true);
  assert.deepEqual(controller.calls, ['clock.pause', 'time.update', 'controls.update', 'moveBy:1']);
});

test('frame navigation while training is already paused does not pause twice', () => {
  const controller = makeController({
    playbackState: 'paused',
    clockState: 'paused',
    trainingPaused: true,
    resumePlaybackAfterTrainingPause: true,
  });
  controller.navigateFrameBy(1);

  assert.equal(controller.trainingClock.state, 'paused');
  assert.equal(controller.trainingPaused, true);
  assert.deepEqual(controller.calls, ['moveBy:1']);
});

test('resuming after manual frame navigation resumes both clock and autoplay', () => {
  const controller = makeController({ playbackState: 'manual', clockState: 'running', index: 1 });
  controller.navigateFrameBy(1);
  controller.calls.length = 0;

  assert.equal(controller.toggleTrainingPause(), true);
  assert.equal(controller.trainingClock.state, 'running');
  assert.equal(controller.playback.state, 'playing');
  assert.equal(controller.trainingPaused, false);
  assert.deepEqual(controller.calls, ['clock.resume', 'playback.resume']);
});

test('ordinary transport uses Reader pages until a real speed session is engaged', async () => {
  const controller = makeController({ playbackState: 'idle', clockState: 'idle' });
  await controller.previousFrame();
  await controller.nextFrame();
  await controller.firstFrame();
  await controller.lastFrame();
  assert.deepEqual(controller.calls, [
    'reader.previousPage', 'reader.nextPage', 'reader.firstPage', 'reader.lastPage',
  ]);
});

test('central control on a running manual frame pauses training instead of advancing manual content', () => {
  const controller = makeController({ playbackState: 'manual', clockState: 'running' });
  let startCalls = 0;
  controller.start = async () => { startCalls += 1; return true; };

  assert.equal(controller.togglePause(), true);
  assert.equal(controller.trainingPaused, true);
  assert.equal(startCalls, 0);
  assert.equal(controller.calls.includes('playback.continueManual'), false);
});
