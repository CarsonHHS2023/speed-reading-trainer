const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Find = require('../reader-find.js');

const documentView = {
  contract_version: '2',
  document_ref: 'doc-1',
  candidate_id: 'candidate-1',
  candidate_schema_id: 'atlas.structured-content.v2',
  candidate_schema_version: 2,
};

function node(id, order, text, sourceUnit = 'su-1') {
  return {
    node_id: id,
    order,
    node_type: 'paragraph',
    text,
    source_unit_ids: [sourceUnit],
    source_anchors: [{ kind: 'text_span', source_unit_id: sourceUnit, start: order * 10, end: order * 10 + text.length }],
    location: {
      contract_version: '2',
      document_ref: 'doc-1',
      candidate_id: 'candidate-1',
      candidate_schema_id: 'atlas.structured-content.v2',
      candidate_schema_version: 2,
      node_id: id,
      source_unit_id: sourceUnit,
      source_anchor: { kind: 'text_span', source_unit_id: sourceUnit, start: order * 10, end: order * 10 + text.length },
    },
  };
}

test('finds Chinese and English literal text with case-insensitive English matching', () => {
  const result = Find.findInNodes(documentView, [
    node('n1', 0, '快速阅读 Reader READER'),
    node('n2', 1, '中文快速阅读训练'),
  ], 'reader');
  assert.deepEqual(result.results.map((item) => item.matched_text), ['Reader', 'READER']);

  const chinese = Find.findInNodes(documentView, [node('n2', 1, '中文快速阅读训练')], '快速');
  assert.equal(chinese.results.length, 1);
  assert.equal(chinese.results[0].matched_text, '快速');
});

test('orders results by semantic node order then in-node match order', () => {
  const result = Find.findInNodes(documentView, [
    node('later', 2, 'x match'),
    node('first', 0, 'match and match'),
  ], 'match');
  assert.deepEqual(result.results.map((item) => [item.node_id, item.match_ordinal]), [
    ['first', 0],
    ['first', 1],
    ['later', 0],
  ]);
});

test('preserves stable Reader v2 identity without presentation-page identity', () => {
  const result = Find.findInNodes(documentView, [node('n1', 0, 'hello world', 'flow-1')], 'world').results[0];
  assert.equal(result.identity.candidate_id, 'candidate-1');
  assert.equal(result.identity.node_id, 'n1');
  assert.equal(result.identity.source_unit_id, 'flow-1');
  assert.equal(result.identity.source_anchor.kind, 'text_span');
  assert.equal(Object.hasOwn(result.identity, 'page_id'), false);
  assert.equal(Object.hasOwn(result.identity, 'presentation_id'), false);
});

test('empty queries return no results and bounded searches report truncation', () => {
  assert.deepEqual(Find.findInNodes(documentView, [node('n1', 0, 'abc')], '   '), { query: '', results: [], truncated: false });
  const bounded = Find.findInNodes(documentView, [node('n1', 0, 'x x x x')], 'x', { maxResults: 2 });
  assert.equal(bounded.results.length, 2);
  assert.equal(bounded.truncated, true);
});

test('candidate changes invalidate prior result identity', () => {
  const result = Find.findInNodes(documentView, [node('n1', 0, 'hello')], 'hello').results[0];
  assert.equal(Find.sameCandidate(result, documentView), true);
  assert.equal(Find.sameCandidate(result, { ...documentView, candidate_id: 'candidate-2' }), false);
});

test('Reader v2 lexical matcher has no legacy content or Reader v1 dependency', () => {
  const source = fs.readFileSync('reader-find.js', 'utf8');
  for (const forbidden of ['cachedContentBlob', 'state.content', 'tokenizeContent', '/api/v1/books/', '/api/reader/v1', 'page_id', 'presentation_id']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
