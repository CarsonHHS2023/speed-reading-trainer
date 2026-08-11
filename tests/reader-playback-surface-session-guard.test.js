const test = require('node:test');
const assert = require('node:assert/strict');

const Polish = require('../reader-playback-polish.js');

function makeController({ playbackState = 'idle', clockState = 'idle' } = {}) {
  return {
    playback: { state: playbackState },
    trainingClock: { state: clockState },
    readerSurfaceCalls: 0,
    playbackSurfaceCalls: 0,
    showReaderSurface() { this.readerSurfaceCalls += 1; },
    showPlaybackSurface() { this.playbackSurfaceCalls += 1; return 'shown'; },
  };
}

test('idle Reader cannot be switched to playback surface by responsive reflow', () => {
  const controller = makeController({ playbackState: 'idle', clockState: 'idle' });
  assert.equal(Polish.wrapPlaybackSurface(controller), true);

  const result = controller.showPlaybackSurface({ frame_id: 'already-built-frame' });

  assert.equal(result, false);
  assert.equal(controller.playbackSurfaceCalls, 0);
  assert.equal(controller.readerSurfaceCalls, 1);
  assert.equal(Polish.isPlaybackSessionEngaged(controller), false);
});

test('paused frame browsing without a running training clock remains in Reader', () => {
  const controller = makeController({ playbackState: 'paused', clockState: 'stopped' });
  Polish.wrapPlaybackSurface(controller);

  controller.showPlaybackSurface({ frame_id: 'paused-frame' });

  assert.equal(controller.playbackSurfaceCalls, 0);
  assert.equal(controller.readerSurfaceCalls, 1);
  assert.equal(Polish.isPlaybackSessionEngaged(controller), false);
});

test('real playing, comprehension-paused, training-paused, and manual sessions may show playback', () => {
  for (const [playbackState, clockState] of [
    ['playing', 'running'],
    ['paused', 'running'],
    ['paused', 'paused'],
    ['manual', 'running'],
  ]) {
    const controller = makeController({ playbackState, clockState });
    Polish.wrapPlaybackSurface(controller);
    assert.equal(controller.showPlaybackSurface({ frame_id: `${playbackState}-${clockState}` }), 'shown');
    assert.equal(controller.playbackSurfaceCalls, 1);
    assert.equal(controller.readerSurfaceCalls, 0);
    assert.equal(Polish.isPlaybackSessionEngaged(controller), true);
  }
});
