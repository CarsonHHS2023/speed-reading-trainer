const test = require('node:test');
const assert = require('node:assert/strict');

const Policy = require('../speed-reading-structure-policy.js');

function node(id, type, text, order = 0) {
  return {
    node_id: id,
    node_type: type,
    text,
    order,
    location: { node_id: id, source_unit_id: 'p1' },
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
  assert.ok(prepared[0].order < prepared[1].order && prepared[1].order < prepared[2].order);
});

test('a single list item remains one logical item and preserves its raw type', () => {
  const [prepared] = Policy.splitStructuredNodes([node('item', 'list-item', '单独目录项')]);
  assert.equal(prepared.node_type, 'list_item');
  assert.equal(prepared.raw_node_type, 'list_item');
  assert.equal(prepared.text, '单独目录项');
});

test('Paddle furniture labels are diagnosed explicitly', () => {
  const diagnostics = Policy.diagnoseNodes([
    node('page', 'number', '1'),
    node('head', 'header', '书名'),
    node('foot', 'footer', '出版社'),
    node('body', 'paragraph', '正文'),
  ]);

  assert.deepEqual(diagnostics.excluded_furniture.map((item) => item.node_type), ['number', 'header', 'footer']);
  assert.equal(diagnostics.type_counts.number, 1);
  assert.equal(diagnostics.type_counts.paragraph, 1);
});

test('numeric paragraph is diagnosed but not reclassified or deleted', () => {
  const source = node('numeric-body', 'paragraph', '2026');
  const prepared = Policy.splitStructuredNodes([source]);
  const diagnostics = Policy.diagnoseNodes(prepared);

  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].node_type, 'paragraph');
  assert.deepEqual(diagnostics.suspicious_numeric_text, [
    { node_id: 'numeric-body', node_type: 'paragraph', text: '2026' },
  ]);
});
