const test = require('node:test');
const assert = require('node:assert/strict');
const Policy = require('../reader-punctuation-hanging-policy.js');

const adapter = {
  countReadingUnits(text) { return Array.from(String(text || '')).length; },
  frameDurationMs(units) { return units * 10; },
};

test('carried character and closing punctuation are restored to the preceding line', () => {
  const frames = [{
    kind: 'timed_text',
    lines: [
      { text: '金融市场本无大' },
      { text: '师。后面的正文' },
    ],
    text: '金融市场本无大\n师。后面的正文',
    reading_units: 0,
    duration_ms: 0,
  }];

  Policy.repairHangingPunctuation(frames, adapter, 600);

  assert.deepEqual(frames[0].lines.map((line) => line.text), [
    '金融市场本无大师。',
    '后面的正文',
  ]);
  assert.equal(frames[0].text, '金融市场本无大师。\n后面的正文');
});

test('ordinary next-line text without carried punctuation is unchanged', () => {
  const frames = [{
    kind: 'timed_text',
    lines: [{ text: '第一行' }, { text: '第二行正文' }],
    text: '第一行\n第二行正文',
  }];

  Policy.repairHangingPunctuation(frames, adapter, 600);
  assert.deepEqual(frames[0].lines.map((line) => line.text), ['第一行', '第二行正文']);
});
