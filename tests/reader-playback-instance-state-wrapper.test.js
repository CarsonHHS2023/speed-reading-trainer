const test = require('node:test');
const assert = require('node:assert/strict');

const Polish = require('../reader-playback-polish.js');

function control() {
  const classes = new Set();
  return {
    disabled: false,
    textContent: '',
    title: '',
    setAttribute() {},
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); },
    },
  };
}

test('an instance-level Debug Toolbar wrapper is still wrapped after the prototype marker exists', () => {
  const toggle = control();
  const hiddenPlayPause = control();
  const prototype = {
    updateControls() {},
  };

  assert.equal(Polish.wrapUpdateControls(prototype), true);
  assert.equal(Object.prototype.hasOwnProperty.call(prototype, '__playbackControlStateWrapped'), true);

  const controller = Object.create(prototype);
  controller.isReaderActive = () => true;
  controller.trainingPaused = true;
  controller.trainingClock = { state: 'paused' };
  controller.element = (id) => {
    if (id === 'readingToggleBtn') return toggle;
    if (id === 'speedReadingPause') return hiddenPlayPause;
    return null;
  };

  // This reproduces ReaderDebugToolbar: the default controller gets its own
  // updateControls function before ReaderPlaybackPolish is loaded.
  controller.updateControls = function debugToolbarUpdateControls() {
    toggle.textContent = '⏹';
    toggle.title = '停止速度阅读';
    toggle.classList.toggle('active', true);
  };

  assert.equal(controller.__playbackControlStateWrapped, true, 'prototype marker is inherited');
  assert.equal(Object.prototype.hasOwnProperty.call(controller, '__playbackControlStateWrapped'), false);
  assert.equal(Polish.wrapUpdateControls(controller), true, 'own updateControls must still be wrapped');
  assert.equal(Object.prototype.hasOwnProperty.call(controller, '__playbackControlStateWrapped'), true);

  controller.updateControls({ state: 'paused', index: 2, frame_count: 8 });
  assert.equal(toggle.textContent, '▶', 'frame navigation pause keeps the Play icon');
  assert.equal(toggle.title, '播放速度阅读');
  assert.equal(toggle.classList.contains('active'), false);

  controller.trainingPaused = false;
  controller.trainingClock.state = 'running';
  controller.updateControls({ state: 'playing', index: 2, frame_count: 8 });
  assert.equal(toggle.textContent, '⏸', 'running training session uses the Pause icon');
  assert.equal(toggle.title, '暂停速度阅读');
  assert.equal(toggle.classList.contains('active'), true);
});
