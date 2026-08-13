const test = require('node:test');
const assert = require('node:assert/strict');

const Lineflow = require('../reader-lineflow-polish.js');

const adapter = {
  countReadingUnits(text) { return Array.from(String(text || '')).length; },
  frameDurationMs(units) { return units * 10; },
};

function frame(id, lines) {
  return {
    frame_id: id,
    kind: 'timed_text',
    lines: lines.map((text) => ({ text, node_type: 'paragraph' })),
    text: lines.join('\n'),
    reading_units: 0,
    duration_ms: 0,
  };
}

test('closing punctuation at a line start is attached to the preceding line', () => {
  const frames = [frame('a', ['这是第一行', '。这是第二行'])];
  Lineflow.rebalanceFrameLines(frames, adapter, 5000);
  assert.deepEqual(frames[0].lines.map((line) => line.text), ['这是第一行。', '这是第二行']);
  assert.equal(frames[0].text, '这是第一行。\n这是第二行');
});

test('punctuation-only first line of the next frame is attached across frame boundary', () => {
  const frames = [frame('a', ['上一帧末行']), frame('b', ['，', '下一帧正文'])];
  Lineflow.rebalanceFrameLines(frames, adapter, 5000);
  assert.equal(frames[0].lines[0].text, '上一帧末行，');
  assert.deepEqual(frames[1].lines.map((line) => line.text), ['下一帧正文']);
});

test('manual frames remain a hard punctuation boundary', () => {
  const frames = [
    frame('a', ['图片前正文']),
    { frame_id: 'image', kind: 'manual', lines: null },
    frame('b', ['。图片后正文']),
  ];
  Lineflow.rebalanceFrameLines(frames, adapter, 5000);
  assert.equal(frames[0].lines[0].text, '图片前正文');
  assert.equal(frames[2].lines[0].text, '。图片后正文');
});

test('measurement reserve uses the actual responsive fontSizePx field and scales for larger fonts', () => {
  assert.equal(Lineflow.measureReservePx({}), 48);
  assert.equal(Lineflow.measureReservePx({ fontSizePx: 28 }), 48);
  assert.equal(Lineflow.measureReservePx({ fontSizePx: 40 }), 60);
  assert.equal(Lineflow.measureReservePx({ fontSize: 50 }), 75);
});
