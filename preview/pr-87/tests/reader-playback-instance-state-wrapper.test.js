const test = require('node:test');
const assert = require('node:assert/strict');

const Polish = require('../reader-playback-polish.js');

function control() {
  return {
    title: '',
    setAttribute() {},
  };
}

test('polish can wrap an instance-level Debug Toolbar update without owning playback state', () => {
  const prev = control();
  const next = control();
  const prototype = {
    updateControls() { this.calls.push('prototype'); },
  };
  assert.equal(Polish.wrapUpdateControls(prototype), true);

  const controller = Object.create(prototype);
  controller.calls = [];
  controller.isPlaybackSessionEngaged = () => false;
  controller.element = (id) => {
    if (id === 'speedReadingPrev') return prev;
    if (id === 'speedReadingNext') return next;
    return null;
  };

  controller.updateControls = function debugToolbarUpdateControls() {
    this.calls.push('debug');
  };
  assert.equal(Polish.wrapUpdateControls(controller), true);
  controller.updateControls();

  assert.deepEqual(controller.calls, ['debug']);
  assert.equal(prev.title, '上一页');
  assert.equal(next.title, '下一页');
  assert.equal(Object.prototype.hasOwnProperty.call(controller, '__playbackPolishLabelsWrapped'), true);
});
