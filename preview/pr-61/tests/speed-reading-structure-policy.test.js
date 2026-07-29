const test = require('node:test');
const assert = require('node:assert/strict');

const Policy = require('../speed-reading-structure-policy.js');

function node(id, type, text, order = 0, extra = {}) {
  return {
    node_id: id,
    node_type: type,
    text,
    order,
    location: { node_id: id, source_unit_id: 'p1' },
    ...extra,
  };
}

test('TOC text is split into one synthetic list item per non-empty line', () => {
  const prepared = Policy.splitStructuredNodes([
    node('toc', 'toc', '第一章 起点\n\n第二章 发展\n第三章 结语', 5),
  ]);

  assert.deepEqual(prepared.map((item) => item.text), ['第一章 起点', '第二章 发展', '第三章 结语']);
  assert.deepEqual(prepared.map((item) => item.node_type), ['list_item', 'list_item', 'list_item']);
  assert.deepEqual(prepared.map((item) => item.raw_node_type), ['toc', 'toc', 'toc']);
  assert.deepEqual(prepared.map((item) => item.node_id), ['toc:toc:0', 'toc:toc:1', 'toc:toc:2']);
});

test('single-line OCR TOC is split at dotted leaders and page numbers', () => {
  const prepared = Policy.prepareStructuredNodes([
    node('toc', 'content', '心语...... 12 第二章 拐点和拐点线...... 17 一、拐点和拐点线...... 17 二、如何绘制拐点线...... 18'),
  ]);
  assert.deepEqual(prepared.map((item) => item.text), [
    '心语...... 12',
    '第二章 拐点和拐点线...... 17',
    '一、拐点和拐点线...... 17',
    '二、如何绘制拐点线...... 18',
  ]);
  assert.ok(prepared.every((item) => item.node_type === 'list_item'));
});

test('Paddle furniture is filtered by exact raw labels including metadata aliases', () => {
  const source = [
    node('page', 'paragraph', 'XIV', 0, { metadata: { provider_block_label: 'page_number' } }),
    node('head', 'header', '书名'),
    node('foot', 'footer', '出版社'),
    node('body', 'paragraph', '正文'),
  ];
  const prepared = Policy.prepareStructuredNodes(source);
  assert.deepEqual(prepared.map((item) => item.node_id), ['body']);
  const diagnostics = Policy.diagnoseNodes(source);
  assert.deepEqual(diagnostics.excluded_furniture.map((item) => item.node_id), ['page', 'head', 'foot']);
});

test('recovered heading semantics override a generic provider text label', () => {
  const prepared = Policy.prepareStructuredNodes([
    node('chapter', 'heading', '第一章 趋势线', 0, {
      heading_level: 1,
      metadata: { provider_block_label: 'text' },
    }),
  ]);

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].node_type, 'heading');
  assert.equal(prepared[0].heading_level, 1);
  assert.equal(prepared[0].raw_node_type, 'text');
});

test('extended Paddle content labels remain playable after an image', () => {
  const prepared = Policy.prepareStructuredNodes([
    node('before', 'text', '图片前正文'),
    node('image', 'image', '图 1'),
    node('abstract', 'abstract', '图片后摘要'),
    node('algorithm', 'algorithm', '步骤一'),
    node('caption', 'figure_caption', '图示说明'),
  ]);
  assert.deepEqual(prepared.map((item) => item.node_type), [
    'paragraph', 'figure', 'paragraph', 'code', 'caption',
  ]);
});

test('standalone punctuation is attached to the previous text node', () => {
  const prepared = Policy.prepareStructuredNodes([
    node('body', 'paragraph', '金融市场本无大师'),
    node('punctuation', 'paragraph', '。'),
  ]);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].text, '金融市场本无大师。');
});

test('formula_number is not treated as page-number furniture', () => {
  const prepared = Policy.prepareStructuredNodes([
    node('formula-number', 'formula_number', '(12)'),
  ]);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].node_type, 'formula_number');
});