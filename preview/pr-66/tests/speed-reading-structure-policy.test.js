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

test('explicit provider structural labels refine broad paragraph semantics', () => {
  const prepared = Policy.prepareStructuredNodes([
    node('figure-title', 'paragraph', '图 1-1', 0, { metadata: { provider_block_label: 'figure_title' } }),
    node('table-title', 'paragraph', '表 1', 1, { metadata: { provider_block_label: 'table_title' } }),
    node('provider-heading', 'paragraph', '第一章', 2, { metadata: { provider_block_label: 'paragraph_title' } }),
  ]);

  assert.deepEqual(prepared.map((item) => item.node_type), ['caption', 'caption', 'heading']);
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

test('ordinary figure/table nodes prefer the durable canonical PDF crop inside their own asset refs', () => {
  const prepared = Policy.prepareStructuredNodes([
    node('figure', 'figure', '', 0, {
      asset_refs: ['provider-image:old', 'pdf-visual:canonical-figure', 'provider-image:other'],
    }),
    node('table', 'table', '', 1, {
      asset_refs: ['provider-table:old', 'pdf-visual:canonical-table'],
    }),
  ]);

  assert.deepEqual(prepared[0].asset_refs, [
    'pdf-visual:canonical-figure', 'provider-image:old', 'provider-image:other',
  ]);
  assert.deepEqual(prepared[1].asset_refs, ['pdf-visual:canonical-table', 'provider-table:old']);
});

test('chapter dividers remain manual visual boundaries while cover/title/back-cover carriers stay excluded', () => {
  const prepared = Policy.prepareStructuredNodes([
    node('cover', 'figure', '', 0, {
      asset_refs: ['pdf-source-rendering:cover'],
      metadata: { presentation_mode: 'source_rendering', presentation_actual_page_kind: 'cover' },
    }),
    node('divider', 'figure', '', 1, {
      asset_refs: ['pdf-source-rendering:divider'],
      metadata: { presentation_mode: 'source_rendering', presentation_actual_page_kind: 'chapter_divider' },
    }),
    node('title-page', 'figure', '', 2, {
      asset_refs: ['pdf-source-rendering:title'],
      metadata: { presentation_mode: 'source_rendering', page_kind: 'title_page' },
    }),
    node('full-figure', 'figure', '', 3, {
      asset_refs: ['pdf-source-rendering:full-figure'],
      metadata: { presentation_mode: 'source_rendering', presentation_actual_page_kind: 'full_page_figure' },
    }),
    node('ordinary', 'figure', '', 4, { asset_refs: ['pdf-visual:ordinary'] }),
  ]);

  assert.deepEqual(prepared.map((item) => item.node_id), ['divider', 'full-figure', 'ordinary']);
  assert.deepEqual(prepared[0].asset_refs, ['pdf-source-rendering:divider']);
  assert.equal(Policy.SPEED_READING_EXCLUDED_PRESENTATION_KINDS.has('chapter_divider'), false);
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