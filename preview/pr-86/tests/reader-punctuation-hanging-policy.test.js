const test = require('node:test');
const assert = require('node:assert/strict');
const Policy = require('../reader-punctuation-hanging-policy.js');

const adapter = {
  countReadingUnits(text) { return Array.from(String(text || '')).length; },
  frameDurationMs(units) { return units * 10; },
};

function identity(nodeId) {
  return { node_id: nodeId, source_unit_id: 'page-1' };
}

test('only leading closing punctuation is restored to the preceding line', () => {
  const paragraph = identity('paragraph-1');
  const frames = [{
    kind: 'timed_text',
    lines: [
      { text: '金融市场本无大师', node_type: 'paragraph', identity: paragraph, source_spans: [paragraph] },
      { text: '。后面的正文', node_type: 'paragraph', identity: paragraph, source_spans: [paragraph] },
    ],
    text: '金融市场本无大师\n。后面的正文',
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

test('a valid next-line character plus closing bracket is never moved backward', () => {
  const paragraph = identity('paragraph-value');
  const frames = [{
    kind: 'timed_text',
    lines: [
      { text: '基本信念和行为规范（价值', node_type: 'paragraph', identity: paragraph, source_spans: [paragraph] },
      { text: '观）企业文化的后续内容', node_type: 'paragraph', identity: paragraph, source_spans: [paragraph] },
    ],
    text: '基本信念和行为规范（价值\n观）企业文化的后续内容',
  }];

  Policy.repairHangingPunctuation(frames, adapter, 600);
  assert.deepEqual(frames[0].lines.map((line) => line.text), [
    '基本信念和行为规范（价值',
    '观）企业文化的后续内容',
  ]);
});

test('a valid next-line character plus comma is never moved backward', () => {
  const paragraph = identity('paragraph-level');
  const frames = [{
    kind: 'timed_text',
    lines: [
      { text: '大约每年可以提高一个西格玛水', node_type: 'paragraph', identity: paragraph, source_spans: [paragraph] },
      { text: '平，直到达到4.7西格玛水平', node_type: 'paragraph', identity: paragraph, source_spans: [paragraph] },
    ],
    text: '大约每年可以提高一个西格玛水\n平，直到达到4.7西格玛水平',
  }];

  Policy.repairHangingPunctuation(frames, adapter, 600);
  assert.deepEqual(frames[0].lines.map((line) => line.text), [
    '大约每年可以提高一个西格玛水',
    '平，直到达到4.7西格玛水平',
  ]);
});

test('TOC/list structural rows never donate their item prefix to the preceding row', () => {
  const frames = [{
    kind: 'timed_text',
    lines: [
      { text: '目录', node_type: 'title', identity: identity('toc-title'), structural_single_row: true },
      { text: '三、趋势..... 71', node_type: 'list_item', identity: identity('toc-3'), structural_single_row: true },
      { text: '四、新的数浪规则..... 129', node_type: 'list_item', identity: identity('toc-4'), structural_single_row: true },
      { text: '五、心语..... 131', node_type: 'list_item', identity: identity('toc-5'), structural_single_row: true },
    ],
    text: '目录\n三、趋势..... 71\n四、新的数浪规则..... 129\n五、心语..... 131',
  }];

  Policy.repairHangingPunctuation(frames, adapter, 600);
  assert.deepEqual(frames[0].lines.map((line) => line.text), [
    '目录',
    '三、趋势..... 71',
    '四、新的数浪规则..... 129',
    '五、心语..... 131',
  ]);
});

test('different paragraph nodes are a hard logical boundary for punctuation repair', () => {
  const frames = [{
    kind: 'timed_text',
    lines: [
      { text: '第一段结尾', node_type: 'paragraph', identity: identity('p1') },
      { text: '。第二段正文', node_type: 'paragraph', identity: identity('p2') },
    ],
    text: '第一段结尾\n。第二段正文',
  }];

  Policy.repairHangingPunctuation(frames, adapter, 600);
  assert.deepEqual(frames[0].lines.map((line) => line.text), ['第一段结尾', '。第二段正文']);
});

test('same-node punctuation-only repair across timed frames refreshes the previous frame text and timing', () => {
  const paragraph = identity('paragraph-cross-frame');
  const frames = [
    {
      kind: 'timed_text',
      lines: [{ text: '金融市场本无大师', node_type: 'paragraph', identity: paragraph }],
      text: '金融市场本无大师',
      reading_units: 0,
      duration_ms: 0,
    },
    {
      kind: 'timed_text',
      lines: [{ text: '。后面的正文', node_type: 'paragraph', identity: paragraph }],
      text: '。后面的正文',
      reading_units: 0,
      duration_ms: 0,
    },
  ];

  Policy.repairHangingPunctuation(frames, adapter, 600);
  assert.equal(frames[0].text, '金融市场本无大师。');
  assert.equal(frames[1].text, '后面的正文');
  assert.equal(frames[0].duration_ms, Array.from(frames[0].text).length * 10);
});

test('ordinary next-line text without leading punctuation is unchanged', () => {
  const paragraph = identity('paragraph-2');
  const frames = [{
    kind: 'timed_text',
    lines: [
      { text: '第一行', node_type: 'paragraph', identity: paragraph },
      { text: '第二行正文', node_type: 'paragraph', identity: paragraph },
    ],
    text: '第一行\n第二行正文',
  }];

  Policy.repairHangingPunctuation(frames, adapter, 600);
  assert.deepEqual(frames[0].lines.map((line) => line.text), ['第一行', '第二行正文']);
});