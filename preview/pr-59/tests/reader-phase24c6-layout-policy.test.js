const test = require('node:test');
const assert = require('node:assert/strict');

const Toc = require('../reader-toc-recovery-policy.js');
const Fragments = require('../reader-fragment-join-policy.js');
const Punctuation = require('../reader-punctuation-hanging-policy.js');
const Paragraphs = require('../reader-paragraph-layout-policy.js');

function element(id, type, text) {
  return {
    element_id: `element:${id}`,
    kind: 'text',
    node_type: type,
    text,
    identity: { candidate_id: 'candidate', node_id: id, source_unit_id: 'page-1' },
  };
}

test('single OCR TOC line is recovered into one list item per entry', () => {
  const recovered = Toc.recoverElements([
    element('toc', 'paragraph', '三、趋势...... 71 四、新的数浪规则...... 129 五、心语...... 131'),
  ]);
  assert.deepEqual(recovered.map((item) => item.text), [
    '三、趋势...... 71',
    '四、新的数浪规则...... 129',
    '五、心语...... 131',
  ]);
  assert.ok(recovered.every((item) => item.node_type === 'list_item'));
});

test('duplicate standalone TOC page headers are removed', () => {
  const recovered = Toc.recoverElements([
    element('toc-heading-1', 'heading', '目录'),
    element('toc-heading-2', 'heading', '目录'),
    element('toc-entry', 'list_item', '三、趋势...... 71'),
  ]);
  assert.deepEqual(recovered.map((item) => item.text), ['目录', '三、趋势...... 71']);
});

test('OCR fragments join within a paragraph but stop after paragraph-ending punctuation', () => {
  const joined = Fragments.joinReadingElements([
    element('p1', 'paragraph', '本书中的理论涵盖了市场的共同特性——'),
    element('p2', 'paragraph', '追随趋势，它是一个交易方法'),
    element('p3', 'paragraph', '这是上一段的结尾。'),
    element('p4', 'paragraph', '这是下一段的开头'),
  ]);
  assert.equal(joined.length, 2);
  assert.equal(joined[0].text, '本书中的理论涵盖了市场的共同特性——追随趋势，它是一个交易方法这是上一段的结尾。');
  assert.equal(joined[1].text, '这是下一段的开头');
});

test('leading OCR whitespace is removed instead of appearing as two blank cells', () => {
  const joined = Fragments.joinReadingElements([
    element('p1', 'paragraph', '交易是一样，'),
    element('p2', 'paragraph', '  不能把简单的工作复杂化。'),
  ]);
  assert.equal(joined[0].text, '交易是一样，不能把简单的工作复杂化。');
});

test('two-cell punctuation is allowed at line start and is not treated as hanging punctuation', () => {
  assert.equal(Punctuation.CARRIED_CHARACTER_AND_PUNCTUATION.test('——追随趋势'), false);
  assert.equal(Punctuation.CARRIED_CHARACTER_AND_PUNCTUATION.test('……追随趋势'), false);
  assert.equal(Punctuation.CARRIED_CHARACTER_AND_PUNCTUATION.test('师。后文'), true);
});

test('only the first line of each paragraph is marked for indentation', () => {
  const frames = [{
    kind: 'timed_text',
    lines: [
      { node_type: 'paragraph', text: '第一行', identity: { source_unit_id: 'p1', node_id: 'n1' } },
      { node_type: 'paragraph', text: '第二行', identity: { source_unit_id: 'p1', node_id: 'n1' } },
      { node_type: 'paragraph', text: '新段', identity: { source_unit_id: 'p1', node_id: 'n2' } },
      { node_type: 'heading', text: '标题', identity: { source_unit_id: 'p1', node_id: 'h1' } },
    ],
  }];
  Paragraphs.markParagraphStarts(frames);
  assert.deepEqual(frames[0].lines.map((line) => line.paragraph_start), [true, false, true, false]);
});