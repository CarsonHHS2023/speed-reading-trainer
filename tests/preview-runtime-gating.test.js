const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('preview-runtime.js', 'utf8');
const STAGING_BASE = 'https://carsonhhs-pdf-ocr-service-staging.hf.space';
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

test('Staging runtime activates on staging and staging PR Preview routes only', () => {
  const production = run('/speed-reading-trainer/');
  assert.equal(production.window.READER_API_BASE_URL, undefined);
  assert.equal(production.window.API_BASE_URL_OVERRIDE, undefined);
  assert.equal(production.window.APP_ACCESS_AUTH_BASE_URL, undefined);

  const staging = run('/speed-reading-trainer/staging/');
  assert.equal(staging.window.READER_API_BASE_URL, STAGING_BASE);
  assert.equal(staging.window.API_BASE_URL_OVERRIDE, STAGING_BASE);
  assert.equal(staging.window.APP_ACCESS_AUTH_BASE_URL, STAGING_BASE);
  assert.equal(staging.window.SPEED_READING_CONFIG.environment, 'staging');
  assert.equal(staging.window.SPEED_READING_CONFIG.frontendBranch, 'staging');
  assert.equal(staging.window.SPEED_READING_CONFIG.backendBranch, 'staging');

  const preview = run('/speed-reading-trainer/preview/staging-pr-70/');
  assert.equal(preview.window.READER_API_BASE_URL, STAGING_BASE);
  assert.equal(preview.window.API_BASE_URL_OVERRIDE, STAGING_BASE);
  assert.equal(preview.window.APP_ACCESS_AUTH_BASE_URL, STAGING_BASE);
  assert.equal(preview.window.SPEED_READING_CONFIG.environment, 'staging-preview');
});

test('Staging runtime rewrites only legacy production backend requests', async () => {
  const { calls, window } = run('/speed-reading-trainer/staging/');
  await window.fetch(`${PROD_BASE}/api/v1/books`);
  await window.fetch('https://example.com/unchanged');
  assert.equal(calls[0], `${STAGING_BASE}/api/v1/books`);
  assert.equal(calls[1], 'https://example.com/unchanged');
});

test('Staging runtime keeps authentication and data requests on the same backend', () => {
  const { window } = run('/speed-reading-trainer/staging/');
  assert.equal(window.APP_ACCESS_AUTH_BASE_URL, window.READER_API_BASE_URL);
  assert.equal(window.APP_ACCESS_AUTH_BASE_URL, window.SPEED_READING_CONFIG.apiBaseUrl);
});

test('Staging runtime no longer owns Reader windowing, navigation, or playback behavior', () => {
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
