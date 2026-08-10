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

test('PR preview auto-loads one bounded Reader chunk near the loaded scroll end', async () => {
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
  assert.equal(loadCalls.length, 1);
  assert.equal(loadCalls[0].silent, true);
  assert.equal(typeof windowObject.__TXT_PREVIEW_READER_AUTOPAGINATION__.nearLoadedEnd, 'function');
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
