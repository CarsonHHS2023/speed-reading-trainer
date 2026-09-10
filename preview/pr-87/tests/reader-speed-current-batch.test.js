const test = require('node:test');
const assert = require('node:assert/strict');

const { ReaderSpeedPlaybackUIController } = require('../reader-speed-playback-ui.js');

function node(order) {
  return { node_id: `n${order}`, order, text: `text ${order}`, node_type: 'paragraph' };
}

function makePlayback() {
  return {
    frames: [],
    index: 0,
    state: 'idle',
    setFrames(frames) { this.frames = [...frames]; this.index = 0; this.state = 'idle'; },
    seek(progress, options = {}) {
      this.index = Math.min(this.frames.length - 1, Math.floor(Number(progress) * this.frames.length));
      if (options.activate === false) this.state = 'idle';
      return this.frames[this.index] || null;
    },
    play() { if (!this.frames.length) return false; this.state = 'playing'; return true; },
    stop() { this.index = 0; this.state = 'idle'; },
    currentFrame() { return this.frames[this.index] || null; },
    snapshot() { return { state: this.state, index: this.index, frame_count: this.frames.length, frame: this.currentFrame() }; },
    previous() { this.index = Math.max(0, this.index - 1); return this.currentFrame(); },
    next() { this.index = Math.min(this.frames.length - 1, this.index + 1); return this.currentFrame(); },
    moveBy(delta) { this.index = Math.max(0, Math.min(this.frames.length - 1, this.index + delta)); return this.currentFrame(); },
  };
}

function makeController() {
  const batch = Array.from({ length: 150 }, (_, index) => node(150 + index));
  const calls = { built: [], loadMore: 0 };
  const reader = {
    openResponse: { candidate_id: 'candidate-1' },
    playbackBatchForCurrentPage() {
      return { start: 150, nodes: batch, firstNodeId: 'n170' };
    },
    windowRecord(start) {
      return start === 150 ? { start, nodes: batch } : null;
    },
    async loadMore() { calls.loadMore += 1; throw new Error('speed start must not load Reader content'); },
    persistLocation() {},
    pageNavigationState() { return { readable: true, pending: false, atDocumentStart: false, atDocumentEnd: false }; },
    setStatus() {},
  };
  const controller = Object.create(ReaderSpeedPlaybackUIController.prototype);
  controller.document = { body: { dataset: { readerV2Active: '1' } } };
  controller.reader = reader;
  controller.playback = makePlayback();
  controller.trainingClock = { state: 'idle', start() { this.state = 'running'; }, stop() { this.state = 'stopped'; } };
  controller.trainingPaused = false;
  controller.comprehensionPaused = false;
  controller.resumePlaybackAfterTrainingPause = false;
  controller.activeBatchStart = null;
  controller.adapter = {
    buildPlaybackFrames(_documentView, nodes) {
      calls.built.push(nodes.map((item) => item.order));
      return {
        frames: nodes.map((item) => ({
          frame_id: `f${item.order}`,
          kind: 'timed_text',
          identity: { node_id: item.node_id },
          source_spans: [{ node_id: item.node_id }],
        })),
      };
    },
  };
  controller.adapterOptions = () => ({ displayScope: 'line', lineWidth: 35, maxLines: 3, speedPerMinute: 600 });
  controller.applyVisualSettings = () => {};
  controller.beginTrainingSession = function begin() { this.trainingClock.start(); };
  controller.stopTrainingTicker = () => {};
  controller.updateTrainingTime = () => {};
  controller.updateControls = () => {};
  controller.showReaderSurface = () => {};
  return { batch, calls, controller, reader };
}

test('speed reading starts from only the current 150-node Reader batch', async () => {
  const { calls, controller } = makeController();
  const started = await controller.start();

  assert.equal(started, true);
  assert.equal(calls.loadMore, 0);
  assert.equal(calls.built.length, 1);
  assert.equal(calls.built[0].length, 150);
  assert.equal(calls.built[0][0], 150);
  assert.equal(calls.built[0].at(-1), 299);
  assert.equal(controller.activeBatchStart, 150);
  assert.equal(controller.playback.state, 'playing');
  assert.equal(controller.playback.currentFrame().identity.node_id, 'n170');
});

test('refresh during an active speed session stays inside the same 150-node batch', async () => {
  const { calls, controller, reader } = makeController();
  await controller.start();
  reader.playbackBatchForCurrentPage = () => ({ start: 300, nodes: Array.from({ length: 150 }, (_, i) => node(300 + i)), firstNodeId: 'n320' });

  controller.refreshFrames({ preserveIdentity: true });

  assert.equal(calls.built.at(-1)[0], 150);
  assert.equal(calls.built.at(-1).at(-1), 299);
  assert.equal(controller.activeBatchStart, 150);
});

test('ordinary transport delegates to Reader pages while an engaged session uses frames', async () => {
  const { controller, reader } = makeController();
  let previousPages = 0;
  let nextPages = 0;
  reader.previousPage = async () => { previousPages += 1; return true; };
  reader.nextPage = async () => { nextPages += 1; return true; };

  await controller.previousFrame();
  await controller.nextFrame();
  assert.equal(previousPages, 1);
  assert.equal(nextPages, 1);

  await controller.start();
  const before = controller.playback.index;
  controller.nextFrame();
  assert.equal(nextPages, 1);
  assert.equal(controller.playback.index, before + 1);
});
