const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ReaderApiClient,
  ReaderApiError,
  assertIdentity,
  normalizeBaseUrl,
} = require('../reader-api.js');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

function identity(overrides = {}) {
  return {
    contract_version: '1',
    document_ref: 'doc-1',
    candidate_id: 'candidate-1',
    candidate_schema_id: 'atlas.structured-content-candidate',
    candidate_schema_version: 1,
    ...overrides,
  };
}

test('normalizeBaseUrl removes trailing slash only', () => {
  assert.equal(normalizeBaseUrl('https://example.test///'), 'https://example.test');
});

test('assertIdentity rejects unsupported contract version', () => {
  assert.throws(
    () => assertIdentity(identity({ contract_version: '2' })),
    (error) => error instanceof ReaderApiError && error.code === 'reader_contract_version_unsupported',
  );
});

test('content request is candidate-bound and bounded', async () => {
  let requestedUrl = '';
  const client = new ReaderApiClient({
    baseUrl: 'https://example.test/',
    fetchImpl: async (url) => {
      requestedUrl = url;
      return jsonResponse({
        ...identity(),
        pages: [],
        has_more: false,
        continuation: null,
      });
    },
  });

  await client.content('doc-1', {
    candidateId: 'candidate-1',
    startPageOrder: 40,
    limit: 999,
  });

  const parsed = new URL(requestedUrl);
  assert.equal(parsed.pathname, '/api/reader/v1/documents/doc-1/content');
  assert.equal(parsed.searchParams.get('candidate_id'), 'candidate-1');
  assert.equal(parsed.searchParams.get('start_page_order'), '40');
  assert.equal(parsed.searchParams.get('limit'), '50');
});

test('candidate change fails closed on response identity', async () => {
  const client = new ReaderApiClient({
    baseUrl: 'https://example.test',
    fetchImpl: async () => jsonResponse({
      ...identity({ candidate_id: 'candidate-2' }),
      pages: [],
      has_more: false,
      continuation: null,
    }),
  });

  await assert.rejects(
    () => client.content('doc-1', { candidateId: 'candidate-1' }),
    (error) => error instanceof ReaderApiError && error.code === 'reader_identity_changed',
  );
});

test('bounded backend error detail is surfaced without raw payload assumptions', async () => {
  const client = new ReaderApiClient({
    baseUrl: 'https://example.test',
    fetchImpl: async () => jsonResponse({
      detail: {
        code: 'reader_selection_changed',
        message: 'The Reader location is stale because the selected content changed.',
      },
    }, 409),
  });

  await assert.rejects(
    () => client.open('doc-1'),
    (error) => error instanceof ReaderApiError
      && error.status === 409
      && error.code === 'reader_selection_changed',
  );
});

test('asset content URL remains bound to document, candidate, and asset identity', () => {
  const client = new ReaderApiClient({
    baseUrl: 'https://example.test',
    fetchImpl: async () => jsonResponse({}),
  });
  const url = new URL(client.assetContentUrl('doc a', 'candidate-1', 'asset/1'));
  assert.equal(url.pathname, '/api/reader/v1/documents/doc%20a/assets/asset%2F1/content');
  assert.equal(url.searchParams.get('candidate_id'), 'candidate-1');
});
