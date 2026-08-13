const test = require('node:test');
const assert = require('node:assert/strict');

const Adapter = require('../speed-reading-adapter.js');
const Layout = require('../speed-reading-responsive-layout.js');
const Lineflow = require('../reader-lineflow-polish.js');

const documentView = {
  contract_version: '2',
  document_ref: 'doc-structured-wrap',
  candidate_id: 'cand-structured-wrap',
  candidate_schema_id: 'atlas.structured-content-v2',
  candidate_schema_version: 2,
  source_units: [{ source_unit_id: 'su-1', source_order: 0, kind: 'text_flow' }],
};

function node(id, type, text) {
  return {
    node_id: id,
    order: 0,
    node_type: type,
    text,
    source_unit_ids: ['su-1'],
    location: {
      node_id: id,
      source_unit_id: 'su-1',
      source_anchor: { kind: 'text_span', start: 0, end: String(text || '').length },
    },
  };
}

function measure(text) {
  let width = 0;
  for (const char of String(text || '')) {
    if (/\p{Script=Han}/u.test(char)) width += 10;
    else if (/[A-Za-z0-9]/u.test(char)) width += 6;
    else if (/\s/u.test(char)) width += 3;
    else width += 5;
  }
  return width;
}

test('long list_item text wraps across measured visual rows instead of overflowing as one atomic row', () => {
  Lineflow.enableWrappedStructureRows(Layout);
  const text = '（1）广告能否引起消费者的注意，是相对的。动态的事物比静态的事物更吸引人，电视广告比图片广告更能让消费者感兴趣。';
  const elements = Adapter.buildReadingElements(documentView, [node('li-1', 'list_item', text)]);
  const lines = Layout.buildMeasuredLines(Adapter, elements, 180, measure, { paragraphLayout: false });

  assert.ok(lines.length > 1);
  assert.equal(lines.map((line) => line.text).join(''), text);
  assert.ok(lines.every((line) => line.measured_width_px <= 180 + 5));
});

test('long list_item wraps in Page, Line, and Block frame construction after lineflow policy is installed', () => {
  Lineflow.enableWrappedStructureRows(Layout);
  const text = '人都是有感情的，引起消费者情感上的共鸣是广告致胜的法宝。例如，献给妈妈的爱，送给最爱的人。';
  for (const displayScope of ['page', 'line', 'block']) {
    const built = Layout.buildMeasuredPlaybackFrames(Adapter, documentView, [node(`li-${displayScope}`, 'list_item', text)], {
      displayScope,
      widthPercent: 100,
      maxWidthPx: 180,
      lineCount: 3,
      pageLineCapacity: 8,
      pageHeightPx: 400,
      lineHeightPx: 30,
      fontSizePx: 20,
      speedPerMinute: 600,
      paragraphLayout: false,
      measureText: measure,
    });
    assert.ok(built.frames.length >= 1, displayScope);
    assert.equal(built.frames.map((frame) => frame.text).join('').replace(/\n/gu, ''), text, displayScope);
    assert.ok(built.frames.some((frame) => (frame.lines || []).length > 1) || built.frames.length > 1, displayScope);
  }
});
