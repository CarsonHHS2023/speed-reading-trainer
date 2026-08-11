const test = require('node:test');
const assert = require('node:assert/strict');

const Transport = require('../reader-transport-semantics.js');

function button() {
  return {
    disabled: false,
    title: '',
    textContent: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
  };
}

function makeHarness(options = {}) {
  const main = {
    scrollTop: Number(options.scrollTop || 0),
    clientHeight: 500,
    listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
  };
  const controls = {
    speedReadingFirst: button(),
    speedReadingPrev: button(),
    speedReadingNext: button(),
    speedReadingLast: button(),
    readingToggleBtn: button(),
  };
  const toolbar = { querySelector: () => null };
  const pages = [];
  const presentationPages = [];

  function addPage(index) {
    const node = { node_id: `node-${index}`, location: { node_id: `node-${index}` } };
    presentationPages.push({ presentation_id: `reflow:${index}`, nodes: [node] });
    pages.push({
      className: 'reader-v2-page reader-v2-page-reflow_page',
      offsetTop: index * 1000,
      offsetHeight: 1000,
      scrollIntoView() { main.scrollTop = index * 1000; },
    });
  }

  const initialPages = Number(options.initialPages || 3);
  for (let index = 0; index < initialPages; index += 1) addPage(index);

  const container = {
    get children() { return pages; },
    querySelectorAll(selector) { return selector === '.reader-v2-page' ? pages : []; },
  };

  let remainingChunks = Number(options.remainingChunks || 0);
  const statuses = [];
  const persisted = [];
  const reader = {
    openResponse: { candidate_id: 'candidate-1' },
    hasMore: remainingChunks > 0,
    nodes: presentationPages.flatMap((page) => page.nodes),
    presentationState: { pages: presentationPages },
    document: {
      querySelector(selector) { return selector === '.reader-v2-main' ? main : null; },
    },
    element(id) { return id === 'readerV2Pages' ? container : null; },
    locationForNode(nodeId) { return { node_id: nodeId }; },
    persistLocation(location) { persisted.push(location.node_id); },
    setStatus(message) { statuses.push(message); },
    renderError(error) { throw error; },
    async loadMore(optionsArg) {
      assert.equal(optionsArg.silent, true);
      if (remainingChunks <= 0) return null;
      addPage(presentationPages.length);
      this.nodes = presentationPages.flatMap((page) => page.nodes);
      remainingChunks -= 1;
      this.hasMore = remainingChunks > 0;
      return {};
    },
  };

  const controller = {
    reader,
    playback: { state: options.playbackState || 'idle' },
    trainingClock: { state: options.clockState || 'idle' },
    isReaderActive: () => true,
    element(id) {
      if (id === 'speedReadingV2Toolbar') return toolbar;
      return controls[id] || null;
    },
  };
  const rootObject = {
    requestAnimationFrame(callback) { callback(); },
    ReaderPlaybackPolish: {
      isPlaybackSessionEngaged(ctrl) {
        return ['playing', 'paused', 'manual'].includes(ctrl.playback.state)
          && ['running', 'paused'].includes(ctrl.trainingClock.state);
      },
    },
  };

  return { addPage, container, controller, controls, main, pages, persisted, reader, rootObject, statuses };
}

test('ordinary Reader transport uses presentation pages instead of playback frames', async () => {
  const harness = makeHarness({ scrollTop: 1000, initialPages: 3 });

  Transport.applyReaderPageControlState(harness.controller, harness.rootObject);
  assert.equal(harness.controls.speedReadingFirst.title, '首页');
  assert.equal(harness.controls.speedReadingPrev.title, '上一页');
  assert.equal(harness.controls.speedReadingNext.title, '下一页');
  assert.equal(harness.controls.speedReadingLast.title, '尾页');
  assert.equal(harness.controls.speedReadingPrev.disabled, false);
  assert.equal(harness.controls.speedReadingNext.disabled, false);

  assert.equal(await Transport.navigateReaderPage(harness.controller, 'previous', harness.rootObject), true);
  assert.equal(harness.main.scrollTop, 0);
  assert.equal(harness.persisted.at(-1), 'node-0');

  assert.equal(await Transport.navigateReaderPage(harness.controller, 'next', harness.rootObject), true);
  assert.equal(harness.main.scrollTop, 1000);
  assert.equal(harness.persisted.at(-1), 'node-1');
});

test('ordinary Reader next page loads one bounded chunk when the next page is not loaded yet', async () => {
  const harness = makeHarness({ scrollTop: 1000, initialPages: 2, remainingChunks: 1 });

  Transport.applyReaderPageControlState(harness.controller, harness.rootObject);
  assert.equal(harness.controls.speedReadingNext.disabled, false);
  assert.equal(await Transport.navigateReaderPage(harness.controller, 'next', harness.rootObject), true);
  assert.equal(harness.pages.length, 3);
  assert.equal(harness.reader.hasMore, false);
  assert.equal(harness.main.scrollTop, 2000);
  assert.equal(harness.persisted.at(-1), 'node-2');
});

test('ordinary Reader tail loads all remaining chunks before navigating to the true last page', async () => {
  const harness = makeHarness({ scrollTop: 0, initialPages: 2, remainingChunks: 3 });

  assert.equal(await Transport.navigateReaderPage(harness.controller, 'last', harness.rootObject), true);
  assert.equal(harness.pages.length, 5);
  assert.equal(harness.reader.hasMore, false);
  assert.equal(harness.main.scrollTop, 4000);
  assert.equal(harness.persisted.at(-1), 'node-4');
  assert.equal(harness.statuses.some((message) => message.includes('正在定位尾页')), true);
  assert.equal(harness.statuses.at(-1), '');
});

test('active speed-reading session keeps frame semantics and rejects ordinary page navigation', async () => {
  const harness = makeHarness({
    scrollTop: 1000,
    initialPages: 3,
    playbackState: 'playing',
    clockState: 'running',
  });
  harness.controls.speedReadingPrev.disabled = true;

  assert.equal(Transport.applyReaderPageControlState(harness.controller, harness.rootObject), false);
  assert.equal(harness.controls.speedReadingPrev.title, '上一帧');
  assert.equal(harness.controls.speedReadingPrev.disabled, true);
  assert.equal(await Transport.navigateReaderPage(harness.controller, 'previous', harness.rootObject), false);
  assert.equal(harness.main.scrollTop, 1000);
});

test('Reader surface activation returns play-button readiness ownership to the speed controller', () => {
  const play = button();
  class FakeReaderController {
    activateReaderSurface() {
      play.disabled = true;
      return 'reader-active';
    }
  }
  const reader = new FakeReaderController();
  let updateCalls = 0;
  const speed = {
    reader,
    updateControls() {
      updateCalls += 1;
      play.disabled = false;
      play.textContent = '▶';
    },
  };
  const rootObject = {
    ReaderUIV2: { ReaderV2Controller: FakeReaderController },
    ReaderSpeedPlaybackUI: { getDefaultController: () => speed },
  };

  assert.equal(Transport.wrapReaderSurfaceActivation(rootObject), true);
  assert.equal(reader.activateReaderSurface(), 'reader-active');
  assert.equal(updateCalls, 1);
  assert.equal(play.disabled, false);
  assert.equal(play.textContent, '▶');
});

test('starting speed reading exposes preparation feedback and restores controls when ready', async () => {
  const play = button();
  const statuses = [];
  let releaseStart;
  const controller = {
    __readerSpeedStartPending: false,
    reader: { setStatus(message) { statuses.push(message); } },
    element(id) { return id === 'readingToggleBtn' ? play : null; },
    updateControls() {
      play.disabled = false;
      play.textContent = '⏸';
      play.title = '暂停速度阅读';
    },
    async start() {
      await new Promise((resolve) => { releaseStart = resolve; });
      return true;
    },
  };

  assert.equal(Transport.wrapStartReadiness(controller, {}), true);
  const starting = controller.start();
  assert.equal(controller.__readerSpeedStartPending, true);
  assert.equal(play.disabled, true);
  assert.equal(play.textContent, '⏳');
  assert.equal(play.title, '正在准备速度阅读…');
  assert.equal(statuses[0], '正在准备速度阅读…');

  await Promise.resolve();
  assert.equal(typeof releaseStart, 'function');
  releaseStart();
  assert.equal(await starting, true);
  assert.equal(controller.__readerSpeedStartPending, false);
  assert.equal(play.disabled, false);
  assert.equal(play.textContent, '⏸');
  assert.equal(statuses.at(-1), '');
});
