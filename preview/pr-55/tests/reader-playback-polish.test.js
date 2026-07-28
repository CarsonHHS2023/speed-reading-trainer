const test = require('node:test');
const assert = require('node:assert/strict');

const Polish = require('../reader-playback-polish.js');

test('resolveResumeIndex finds exact frame id and falls back to node identity', () => {
  const frames = [
    { frame_id: 'f-1', frame_ordinal: 0, identity: { node_id: 'n-1' } },
    { frame_id: 'f-2', frame_ordinal: 1, identity: { node_id: 'n-2' } },
  ];

  assert.equal(Polish.resolveResumeIndex({
    reader: { resumeRecord: { frame_id: 'f-2' } },
    playback: { frames },
  }), 1);

  assert.equal(Polish.resolveResumeIndex({
    reader: { resumeRecord: { frame_id: 'missing', node_id: 'n-1', frame_ordinal: 0 } },
    playback: { frames },
  }), 0);
});

test('restoreResumeFrame defers seeking until playback starts', async () => {
  class Controller {
    constructor() {
      this.reader = { resumeRecord: { frame_id: 'manual-frame' } };
      this.playback = {
        frames: [
          { frame_id: 'text-frame', kind: 'timed' },
          { frame_id: 'manual-frame', kind: 'manual' },
        ],
        index: 0,
        play() { this.playedIndex = this.index; return true; },
      };
    }
    async start() { return this.playback.play(); }
    renderManualFrame() {}
  }

  assert.equal(Polish.install({ ReaderSpeedPlaybackUI: { ReaderSpeedPlaybackUIController: Controller } }), true);
  const controller = new Controller();

  assert.equal(controller.restoreResumeFrame(), true);
  assert.equal(controller.playback.index, 0, 'opening the book does not seek into the image');
  assert.equal(controller.pendingResumeFrameIndex, 1);

  assert.equal(await controller.start(), true);
  assert.equal(controller.playback.playedIndex, 1, 'resume position is applied only when playback starts');
  assert.equal(controller.pendingResumeFrameIndex, null);
});

test('terminal manual frame is labelled as the last frame and returns to reader view', () => {
  class Controller {
    constructor() {
      this.playback = { frames: [{ kind: 'manual' }], index: 0 };
      this.stopped = false;
    }
    async start() { return true; }
    stop() { this.stopped = true; }
    renderManualFrame(_frame, target) {
      target.button = { textContent: '继续', onclick: null };
    }
  }

  Polish.install({ ReaderSpeedPlaybackUI: { ReaderSpeedPlaybackUIController: Controller } });
  const controller = new Controller();
  const target = { querySelector: () => target.button };

  controller.renderManualFrame({ kind: 'manual' }, target);
  assert.equal(target.button.textContent, '最后一帧 · 返回阅读视图');
  target.button.onclick({ stopPropagation() {} });
  assert.equal(controller.stopped, true);
});
