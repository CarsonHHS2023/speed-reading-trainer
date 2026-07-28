const test = require('node:test');
const assert = require('node:assert/strict');
const Adapter = require('../speed-reading-adapter.js');
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
    identity: { candidate_id: 'candidate', node_id: id, source_unit_id: 'page-1' },
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

test('same-source paragraph fragments continue without artificial short lines', () => {
  const lines = Layout.buildMeasuredLines(Adapter, [
    element('p1', 'paragraph', '本书是作者16年的股票、'),
    element('p2', 'paragraph', '期货和外汇交易过程中总结出来的'),
  ], 1000, measure);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, '本书是作者16年的股票、期货和外汇交易过程中总结出来的');
});

test('closing punctuation never begins a measured line', () => {
  const lines = Layout.buildMeasuredLines(Adapter, [
    element('p1', 'paragraph', '金融市场本无大师。'),
  ], 85, measure);
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
