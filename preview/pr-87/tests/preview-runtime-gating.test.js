const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('preview-runtime.js', 'utf8');
const TEST_BASE = 'https://carsonhhs-pdf-ocr-service-ocrmypdf-test.hf.space';
const PROD_BASE = 'https://carsonhhs-pdf-ocr-service.hf.space';

function run(pathname) {
  const calls = [];
  class FakeRequest {
    constructor(url) { this.url = String(url); }
  }
  const window = {
    location: { pathname },
    URL,
    Request: FakeRequest,
    console: { info() {} },
    fetch(input) {
      calls.push(typeof input === 'string' ? input : input.url);
      return Promise.resolve({ ok: true });
    },
  };
  window.window = window;
  vm.runInNewContext(source, { window, globalThis: window, URL, Request: FakeRequest });
  return { calls, window };
}

test('Preview runtime activates only on PR Preview routes', () => {
  const production = run('/speed-reading-trainer/');
  assert.equal(production.window.READER_API_BASE_URL, undefined);
  assert.equal(production.window.API_BASE_URL_OVERRIDE, undefined);

  const preview = run('/speed-reading-trainer/preview/pr-70/');
  assert.equal(preview.window.READER_API_BASE_URL, TEST_BASE);
  assert.equal(preview.window.API_BASE_URL_OVERRIDE, TEST_BASE);
  assert.equal(preview.window.SPEED_READING_CONFIG.apiBaseUrl, TEST_BASE);
});

test('Preview runtime rewrites only legacy production backend requests', async () => {
  const { calls, window } = run('/speed-reading-trainer/preview/pr-70/');
  await window.fetch(`${PROD_BASE}/api/v1/books`);
  await window.fetch('https://example.com/unchanged');
  assert.equal(calls[0], `${TEST_BASE}/api/v1/books`);
  assert.equal(calls[1], 'https://example.com/unchanged');
});

test('Preview runtime no longer owns Reader windowing, navigation, or playback behavior', () => {
  for (const forbidden of [
    'installAsyncReaderNavigation',
    'installBoundedReaderAutoPagination',
    'installPlaybackBrowsingIsolation',
    'installIncrementalReaderChunkRendering',
    'ReaderSpeedPlaybackUI',
    'ReaderUIV2',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});