const test = require('node:test');
const assert = require('node:assert/strict');
const Adapter = require('../speed-reading-adapter.js');
const FragmentJoin = require('../reader-fragment-join-policy.js');
const Layout = require('../speed-reading-responsive-layout.js');

function measure(text, nodeType = 'paragraph') {
  const scale = nodeType === 'title' ? 1.5 : nodeType === 'heading' ? 1.22 : 1;
  let width = 0;
  for (const char of String(text || '')) {
    if (/\p{Script=Han}/u.test(char)) width += 10;
    else if (/[A-Za-z0-9]/u.test(char)) width += 6;
    else if (/\s/u.test(char)) width += 3;
    else width += 5;
  }
  return width * scale;
}

function element(id, type, text, extra = {}) {
  return {
    element_id: `element:${id}`,
    kind: 'text',
    node_type: type,
    text,
    identity: {
      candidate_id: 'candidate',
      node_id: id,
      source_unit_id: 'page-1',
      ...(extra.source_anchor ? { source_anchor: extra.source_anchor } : {}),
    },
    source_unit_kind: 'text_flow',
    ...extra,
  };
}

test('TOC list items remain separate measured lines', () => {
  const lines = Layout.buildMeasuredLines(Adapter, [
    element('toc-1', 'list_item', '三、趋势...... 71'),
    element('toc-2', 'list_item', '四、新的数浪规则...... 129'),
    element('toc-3', 'list_item', '五、心语...... 131'),
  ], 1000, measure);
  assert.deepEqual(lines.map((line) => line.text), [
    '三、趋势...... 71',
    '四、新的数浪规则...... 129',
    '五、心语...... 131',
  ]);
});

test('true same-source paragraph fragments join without an artificial CJK space', () => {
  const joined = FragmentJoin.joinReadingElements([
    element('p:page-fragment:0', 'paragraph', '本书是作者16年的股票、'),
    element('p:page-fragment:1', 'paragraph', '期货和外汇交易过程中总结出来的'),
  ]);
  const lines = Layout.buildMeasuredLines(Adapter, joined, 1000, measure);
  assert.equal(joined.length, 1);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, '本书是作者16年的股票、期货和外汇交易过程中总结出来的');
});

test('contiguous text-span evidence can join OCR fragments without text heuristics', () => {
  const joined = FragmentJoin.joinReadingElements([
    element('fragment-a', 'paragraph', 'alpha', { source_anchor: { kind: 'text_span', start: 0, end: 5 } }),
    element('fragment-b', 'paragraph', 'beta', { source_anchor: { kind: 'text_span', start: 5, end: 9 } }),
  ]);
  assert.equal(joined.length, 1);
  assert.equal(joined[0].text, 'alpha beta');
});

test('distinct canonical paragraphs sharing one TXT source unit are not fragment-joined', () => {
  const joined = FragmentJoin.joinReadingElements([
    element('p1', 'paragraph', '第一段。', { source_anchor: { kind: 'text_span', start: 0, end: 4 } }),
    element('p2', 'paragraph', '第二段。', { source_anchor: { kind: 'text_span', start: 6, end: 10 } }),
  ]);
  assert.equal(joined.length, 2);
  assert.deepEqual(joined.map((item) => item.identity.node_id), ['p1', 'p2']);
});

test('closing punctuation never begins a measured line', () => {
  const lines = Layout.buildMeasuredLines(Adapter, [
    element('p1', 'paragraph', '金融市场本无大师。'),
  ], 55, measure);
  assert.ok(lines.length >= 2);
  assert.ok(lines.every((line) => !/^[，。；：！？、]/u.test(line.text)));
  assert.equal(lines.map((line) => line.text).join(''), '金融市场本无大师。');
});

test('heading level survives into the rendered line contract', () => {
  const [line] = Layout.buildMeasuredLines(Adapter, [
    element('heading', 'heading', '第一章 趋势线', { heading_level: 1 }),
  ], 1000, measure);
  assert.equal(line.node_type, 'heading');
  assert.equal(line.heading_level, 1);
});
