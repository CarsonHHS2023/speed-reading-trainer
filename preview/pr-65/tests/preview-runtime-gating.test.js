const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const runtimeSource = fs.readFileSync(
  path.join(__dirname, '..', 'preview-runtime.js'),
  'utf8',
);
const TEST_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service-ocrmypdf-test.hf.space';

function executeRuntime(pathname) {
  const nativeFetch = async () => ({ ok: false, url: '' });
  const messages = [];
  const windowObject = {
    location: {
      pathname,
      href: `https://carsonhhs2023.github.io${pathname}`,
    },
    fetch: nativeFetch,
    console: {
      info(...args) {
        messages.push(args);
      },
      warn() {},
    },
  };
  const context = vm.createContext({
    window: windowObject,
    URL,
    Request: global.Request,
    CustomEvent: class CustomEvent {},
    console: windowObject.console,
  });

  vm.runInContext(runtimeSource, context, { filename: 'preview-runtime.js' });
  return { windowObject, nativeFetch, messages };
}

test('production Pages root does not install preview API overrides', () => {
  const { windowObject, nativeFetch, messages } = executeRuntime(
    '/speed-reading-trainer/',
  );

  assert.equal(windowObject.fetch, nativeFetch);
  assert.equal(windowObject.READER_API_BASE_URL, undefined);
  assert.equal(windowObject.API_BASE_URL_OVERRIDE, undefined);
  assert.equal(windowObject.SPEED_READING_CONFIG, undefined);
  assert.equal(windowObject.previewProcessing, undefined);
  assert.match(messages[0][0], /runtime skipped outside PR preview/);
});

test('non-PR preview paths also remain production-safe', () => {
  const { windowObject, nativeFetch } = executeRuntime(
    '/speed-reading-trainer/preview/',
  );

  assert.equal(windowObject.fetch, nativeFetch);
  assert.equal(windowObject.READER_API_BASE_URL, undefined);
});

test('PR preview path installs the test backend runtime', () => {
  const { windowObject, nativeFetch } = executeRuntime(
    '/speed-reading-trainer/preview/pr-65/',
  );

  assert.notEqual(windowObject.fetch, nativeFetch);
  assert.equal(windowObject.READER_API_BASE_URL, TEST_API_BASE_URL);
  assert.equal(windowObject.API_BASE_URL_OVERRIDE, TEST_API_BASE_URL);
  assert.equal(windowObject.SPEED_READING_CONFIG.environment, 'preview');
  assert.equal(windowObject.SPEED_READING_CONFIG.frontendBranch, 'preview');
  assert.equal(
    windowObject.SPEED_READING_CONFIG.backendBranch,
    'deploy/ocrmypdf-test',
  );
});

test('PR preview index document path is accepted', () => {
  const { windowObject } = executeRuntime(
    '/speed-reading-trainer/preview/pr-123/index.html',
  );

  assert.equal(windowObject.READER_API_BASE_URL, TEST_API_BASE_URL);
});
