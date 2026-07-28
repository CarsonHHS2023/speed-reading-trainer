const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Adapter = require('../speed-reading-adapter.js');

const view = {
  contract_version: '2',
  document_ref: 'doc',
  candidate_id: 'cand',
  candidate_schema_id: 'atlas.structured-content-v2',
  candidate_schema_version: 2,
  source_units: [{ source_unit_id: 'p1', source_order: 0, kind: 'physical_page' }],
};

function node(id, order, type, text) {
  return {
    node_id: id,
    order,
    node_type: type,
    text,
    source_unit_ids: ['p1'],
    location: { node_id: id, source_unit_id: 'p1', source_anchor: { kind: 'text_span', start: order, end: order + text.length } },
  };
}

test('line scope groups continuous visual lines by configured line count', () => {
  const result = Adapter.buildPlaybackFrames(view, [
    node('a', 0, 'paragraph', '第一行短句'),
    node('b', 1, 'paragraph', '第二行短句'),
    node('c', 2, 'paragraph', '第三行短句'),
    node('d', 3, 'paragraph', '第四行短句'),
  ], { displayScope: 'line', lineWidth: 35, maxLines: 3, speedPerMinute: 600 });
  assert.equal(result.frames.length, 2);
  assert.equal(result.frames[0].lines.length, 3);
  assert.equal(result.frames[1].lines.length, 1);
});

test('PDF OCR soft wraps are joined before visual wrapping', () => {
  assert.equal(Adapter.normalizeSoftWraps('这是一个\n连续中文句子'), '这是一个连续中文句子');
  assert.equal(Adapter.normalizeSoftWraps('Google\nResearch'), 'Google Research');
});

test('35 CJK characters occupy 35 logical display cells', () => {
  const text = '汉'.repeat(35);
  assert.equal(Adapter.displayWidth(text), 35);
  assert.equal(Adapter.tokensToLines(Adapter.tokenizeReadingText(text), 35).length, 1);
  assert.equal(Adapter.tokensToLines(Adapter.tokenizeReadingText(`${text}汉`), 35).length, 2);
});

test('frames preserve per-line title and body hierarchy', () => {
  const result = Adapter.buildPlaybackFrames(view, [
    node('title', 0, 'title', '浪潮之巅'),
    node('body', 1, 'paragraph', '正文内容'),
  ], { displayScope: 'line', lineWidth: 35, maxLines: 3, speedPerMinute: 600 });
  assert.deepEqual(result.frames[0].lines.map((line) => line.node_type), ['title', 'paragraph']);
});

test('playback CSS uses em character measure and avoids clipped inline padding', () => {
  const css = fs.readFileSync(require.resolve('../speed-reading-v2.css'), 'utf8');
  assert.match(css, /--speed-reading-measure:\s*35em/);
  assert.match(css, /padding-inline:\s*0\s*!important/);
  assert.match(css, /\.reader-playback-line-title/);
  assert.match(css, /white-space:\s*nowrap/);
});
