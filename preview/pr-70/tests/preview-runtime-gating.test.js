const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const runtimeSource = fs.readFileSync(
  path.join(__dirname, '..', 'preview-runtime.js'),
  'utf8',
);

const PRODUCTION_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service.hf.space';
const TEST_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service-ocrmypdf-test.hf.space';

function fakeElement(tag = 'div') {
  return {
    tagName: tag.toUpperCase(),
    className: '',
    dataset: {},
    textContent: '',
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const index = this.children.indexOf(child);
      if (index >= 0) this.children.splice(index, 1);
      return child;
    },
  };
}

function executeRuntime(pathname, options = {}) {
  const calls = [];
  const nativeFetch = async (input, init) => {
    calls.push({ input, init });
    return { ok: true, url: String(input) };
  };
  const messages = [];
  const windowObject = {
    location: {
      pathname,
      href: `https://carsonhhs2023.github.io${pathname}`,
    },
    fetch: nativeFetch,
    Request: global.Request,
    document: options.documentObject,
    ReaderUIV2: options.readerUI,
    console: {
      info(...args) {
        messages.push(args);
      },
    },
  };
  const context = vm.createContext({
    window: windowObject,
    URL,
    Request: global.Request,
    console: windowObject.console,
  });

  vm.runInContext(runtimeSource, context, { filename: 'preview-runtime.js' });
  return { windowObject, nativeFetch, calls, messages };
}

test('production Pages root does not install preview API overrides', () => {
  const { windowObject, nativeFetch, messages } = executeRuntime('/speed-reading-trainer/');

  assert.equal(windowObject.fetch, nativeFetch);
  assert.equal(windowObject.READER_API_BASE_URL, undefined);
  assert.equal(windowObject.API_BASE_URL_OVERRIDE, undefined);
  assert.equal(windowObject.SPEED_READING_CONFIG, undefined);
  assert.match(messages[0][0], /runtime skipped outside PR preview/);
});

test('non-PR preview paths also remain production-safe', () => {
  const { windowObject, nativeFetch } = executeRuntime('/speed-reading-trainer/preview/');

  assert.equal(windowObject.fetch, nativeFetch);
  assert.equal(windowObject.READER_API_BASE_URL, undefined);
});

test('PR preview path installs the HF test backend runtime', () => {
  const { windowObject, nativeFetch } = executeRuntime('/speed-reading-trainer/preview/pr-101/');

  assert.notEqual(windowObject.fetch, nativeFetch);
  assert.equal(windowObject.READER_API_BASE_URL, TEST_API_BASE_URL);
  assert.equal(windowObject.API_BASE_URL_OVERRIDE, TEST_API_BASE_URL);
  assert.equal(windowObject.SPEED_READING_CONFIG.environment, 'preview');
  assert.equal(windowObject.SPEED_READING_CONFIG.frontendBranch, 'preview-txt-hf-test');
  assert.equal(windowObject.SPEED_READING_CONFIG.backendBranch, 'deploy/ocrmypdf-test');
});

test('PR preview rewrites production upload and bookshelf requests to the test Space', async () => {
  const { windowObject, calls } = executeRuntime('/speed-reading-trainer/preview/pr-101/');

  await windowObject.fetch(`${PRODUCTION_API_BASE_URL}/api/v1/upload`, { method: 'POST' });
  await windowObject.fetch(`${PRODUCTION_API_BASE_URL}/api/v1/books`);

  assert.equal(calls[0].input, `${TEST_API_BASE_URL}/api/v1/upload`);
  assert.equal(calls[1].input, `${TEST_API_BASE_URL}/api/v1/books`);
});

test('PR preview leaves unrelated fetch destinations untouched', async () => {
  const { windowObject, calls } = executeRuntime('/speed-reading-trainer/preview/pr-101/index.html');

  await windowObject.fetch('https://example.com/data');
  assert.equal(calls[0].input, 'https://example.com/data');
});

test('PR preview auto-load requires real forward scroll progress before another bounded chunk', async () => {
  const listeners = {};
  const main = {
    dataset: {},
    scrollHeight: 2200,
    scrollTop: 1500,
    clientHeight: 600,
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
  };
  const documentObject = {
    readyState: 'complete',
    querySelector(selector) {
      return selector === '.reader-v2-main' ? main : null;
    },
  };
  const loadCalls = [];
  const controller = {
    candidateId: 'candidate-1',
    openResponse: { candidate_id: 'candidate-1' },
    hasMore: true,
    async loadMore(options) {
      loadCalls.push(options);
      return { has_more: true };
    },
  };

  const { windowObject } = executeRuntime('/speed-reading-trainer/preview/pr-101/', {
    documentObject,
    readerUI: { getDefaultController: () => controller },
  });

  assert.equal(main.dataset.previewAutoPaginationBound, '1');
  assert.equal(typeof listeners.scroll, 'function');
  await listeners.scroll();
  await listeners.scroll();
  assert.equal(loadCalls.length, 1);
  assert.equal(loadCalls[0].silent, true);

  main.scrollHeight = 3200;
  main.scrollTop = 2500;
  await listeners.scroll();
  assert.equal(loadCalls.length, 2);
  assert.equal(typeof windowObject.__TXT_PREVIEW_READER_AUTOPAGINATION__.nearLoadedEnd, 'function');
});

test('PR preview resets scroll-progress gating for a newly selected candidate', async () => {
  const listeners = {};
  const main = {
    dataset: {},
    scrollHeight: 2200,
    scrollTop: 1500,
    clientHeight: 600,
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
  };
  const documentObject = {
    readyState: 'complete',
    querySelector(selector) {
      return selector === '.reader-v2-main' ? main : null;
    },
  };
  let loadCount = 0;
  const controller = {
    candidateId: 'candidate-1',
    openResponse: { candidate_id: 'candidate-1' },
    hasMore: true,
    async loadMore() {
      loadCount += 1;
    },
  };

  executeRuntime('/speed-reading-trainer/preview/pr-101/', {
    documentObject,
    readerUI: { getDefaultController: () => controller },
  });
  await listeners.scroll();
  assert.equal(loadCount, 1);

  controller.candidateId = 'candidate-2';
  controller.openResponse = { candidate_id: 'candidate-2' };
  await listeners.scroll();
  assert.equal(loadCount, 2);
});

test('PR preview does not auto-load Reader chunks while far from the loaded end', async () => {
  const listeners = {};
  const main = {
    dataset: {},
    scrollHeight: 5000,
    scrollTop: 800,
    clientHeight: 600,
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
  };
  const documentObject = {
    readyState: 'complete',
    querySelector(selector) {
      return selector === '.reader-v2-main' ? main : null;
    },
  };
  let loadCount = 0;
  const controller = {
    candidateId: 'candidate-1',
    openResponse: { candidate_id: 'candidate-1' },
    hasMore: true,
    async loadMore() {
      loadCount += 1;
    },
  };

  executeRuntime('/speed-reading-trainer/preview/pr-101/', {
    documentObject,
    readerUI: { getDefaultController: () => controller },
  });
  await listeners.scroll();
  assert.equal(loadCount, 0);
});

test('PR preview preserves stable reflow page DOM and renders only the changed suffix', async () => {
  const nodeA = { node_id: 'a' };
  const nodeB = { node_id: 'b' };
  const firstPage = { presentation_id: 'reflow:0', kind: 'reflow_page', nodes: [nodeA] };
  const secondPage = { presentation_id: 'reflow:1', kind: 'reflow_page', nodes: [nodeB] };
  const pagesContainer = fakeElement('div');
  const stableSection = fakeElement('section');
  stableSection.dataset.presentationId = 'reflow:0';
  pagesContainer.appendChild(stableSection);
  let delegatedOptions = null;

  class FakeReaderV2Controller {
    constructor() {
      this.openResponse = { candidate_id: 'candidate-1' };
      this.presentationState = { mode: 'reflow', pages: [firstPage] };
      this.nodes = [nodeA];
      this.document = { createElement: (tag) => fakeElement(tag) };
      this.presentation = {
        presentationForDocument: () => ({ mode: 'reflow', pages: [firstPage, secondPage] }),
      };
    }
    async loadMore(options) {
      delegatedOptions = options;
      this.nodes.push(nodeB);
      return { nodes: [nodeB], has_more: false };
    }
    element(id) {
      return id === 'readerV2Pages' ? pagesContainer : null;
    }
    presentationOptions() {
      return {};
    }
    renderNode(node) {
      const rendered = fakeElement('article');
      rendered.dataset.readerNodeId = node.node_id;
      return rendered;
    }
    activateReaderSurface() {}
  }

  const documentObject = {
    readyState: 'complete',
    querySelector() {
      return null;
    },
  };
  const readerUI = {
    ReaderV2Controller: FakeReaderV2Controller,
    getDefaultController: () => null,
  };
  const { windowObject } = executeRuntime('/speed-reading-trainer/preview/pr-101/', {
    documentObject,
    readerUI,
  });

  const controller = new FakeReaderV2Controller();
  await controller.loadMore({ silent: true });

  assert.equal(delegatedOptions.deferRender, true);
  assert.equal(pagesContainer.children.length, 2);
  assert.equal(pagesContainer.children[0], stableSection);
  assert.equal(pagesContainer.children[1].dataset.presentationId, 'reflow:1');
  assert.equal(windowObject.__TXT_PREVIEW_READER_INCREMENTAL_RENDER__ !== undefined, true);
});
