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

function executeRuntime(pathname) {
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
