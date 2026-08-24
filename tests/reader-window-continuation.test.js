const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AUTO_WINDOW_ROOT_MARGIN_PX,
  installReaderWindowContinuation,
  shouldContinueReaderWindow,
} = require('../reader-boundary-navigation.js');

function makeMain() {
  const handlers = new Map();
  return {
    scrollHeight: 3200,
    scrollTop: 0,
    clientHeight: 800,
    addEventListener(type, handler) { handlers.set(type, handler); },
    dispatch(type) { handlers.get(type)?.({ type }); },
  };
}

function makeHarness() {
  const main = makeMain();
  const loadMoreButton = {};
  const documentHandlers = new Map();
  const documentObject = {
    defaultView: {},
    querySelector(selector) { return selector === '.reader-v2-main' ? main : null; },
    getElementById(id) { return id === 'readerV2LoadMore' ? loadMoreButton : null; },
    addEventListener(type, handler) { documentHandlers.set(type, handler); },
    dispatch(type, detail) { documentHandlers.get(type)?.({ type, detail }); },
  };
  let resolveLoad = null;
  const calls = [];
  const reader = {
    document: documentObject,
    hasMore: true,
    navigationPending: false,
    opening: false,
    autoLoadPromise: null,
    element(id) { return id === 'readerV2LoadMore' ? loadMoreButton : null; },
    currentPageFirstNode() { return { node_id: 'n149' }; },
    loadMore(options) {
      calls.push(options);
      return new Promise((resolve) => { resolveLoad = resolve; });
    },
    emitPageChange() {},
    renderError(error) { throw error; },
  };
  let observerCallback = null;
  class FakeIntersectionObserver {
    constructor(callback, options) {
      observerCallback = callback;
      this.options = options;
      this.observed = [];
    }
    observe(value) { this.observed.push(value); }
  }
  const rootObject = {
    IntersectionObserver: FakeIntersectionObserver,
    requestAnimationFrame(callback) { callback(); },
  };
  return {
    calls,
    documentObject,
    loadMoreButton,
    main,
    reader,
    resolveLoad: () => resolveLoad?.(),
    rootObject,
    triggerIntersection(isIntersecting = true) { observerCallback?.([{ isIntersecting }]); },
  };
}

test('continuation threshold remains bounded near the loaded-window end', () => {
  const main = makeMain();
  const reader = { hasMore: true };
  main.scrollTop = 1700;
  assert.equal(shouldContinueReaderWindow(reader, main), false);
  main.scrollTop = 1900;
  assert.equal(shouldContinueReaderWindow(reader, main), true);
  assert.equal(AUTO_WINDOW_ROOT_MARGIN_PX, 600);
});

test('continuation refuses terminal, opening, and already-pending states', () => {
  const main = makeMain();
  main.scrollTop = 2000;
  assert.equal(shouldContinueReaderWindow({ hasMore: false }, main), false);
  assert.equal(shouldContinueReaderWindow({ hasMore: true, opening: true }, main), false);
  assert.equal(shouldContinueReaderWindow({ hasMore: true, navigationPending: true }, main), false);
  assert.equal(shouldContinueReaderWindow({ hasMore: true, autoLoadPromise: Promise.resolve() }, main), false);
  assert.equal(shouldContinueReaderWindow({ hasMore: true, __windowContinuationPromise: Promise.resolve() }, main), false);
});

test('near-end scroll continues with exactly one bounded load while a request is in flight', async () => {
  const harness = makeHarness();
  assert.equal(installReaderWindowContinuation(harness.reader, harness.rootObject), true);
  harness.main.scrollTop = 2000;
  harness.main.dispatch('scroll');
  harness.main.dispatch('wheel');
  harness.triggerIntersection(true);

  assert.equal(harness.calls.length, 1);
  assert.deepEqual(harness.calls[0], {
    silent: true,
    anchorNodeId: 'n149',
    anchorBlock: 'start',
  });

  harness.resolveLoad();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(harness.reader.__windowContinuationPromise, null);
});

test('page-change fallback continues when the current visible window reaches its last two pages', () => {
  const harness = makeHarness();
  assert.equal(installReaderWindowContinuation(harness.reader, harness.rootObject), true);
  harness.main.scrollTop = 2000;
  harness.documentObject.dispatch('reader-v2-page-change', {
    readable: true,
    pending: false,
    atDocumentEnd: false,
    index: 14,
    pageCount: 16,
  });
  assert.equal(harness.calls.length, 1);
});

test('install observes the existing Load More sentinel without changing the 150-node contract itself', () => {
  const harness = makeHarness();
  assert.equal(installReaderWindowContinuation(harness.reader, harness.rootObject), true);
  const observer = harness.reader.__windowContinuationObserver;
  assert.ok(observer);
  assert.deepEqual(observer.observed, [harness.loadMoreButton]);
  assert.equal(observer.options.root, harness.main);
  assert.equal(observer.options.rootMargin, '0px 0px 600px 0px');
});
