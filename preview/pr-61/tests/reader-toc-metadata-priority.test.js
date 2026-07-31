const test = require('node:test');
const assert = require('node:assert/strict');

const Integration = require('../reader-semantic-page-integration.js');

function anchor(left, top = 0.2) {
  return {
    kind: 'spatial',
    source_unit_id: 'pdf-page:000001',
    normalized_bbox: [left, top, 0.88, top + 0.04],
  };
}

function tocItem(nodeId, text, left, metadata = {}) {
  return {
    node_id: nodeId,
    node_type: 'list_item',
    text,
    metadata: {
      recovery_rule: 'mineru_popo_toc_item',
      ...metadata,
    },
    location: { source_anchor: anchor(left) },
  };
}

function tocPage(items) {
  return {
    presentation_id: 'semantic-page:pdf-page:000001',
    kind: 'semantic_full_page',
    source_unit_id: 'pdf-page:000001',
    source_order: 0,
    source_unit: { dimensions: { width: 888, height: 1226, unit: 'pixel' } },
    nodes: [
      {
        node_id: 'toc-heading',
        node_type: 'heading',
        text: '目录',
        metadata: { recovery_rule: 'mineru_popo_heading' },
        location: { source_anchor: anchor(0.38, 0.12) },
      },
      {
        node_id: 'toc-list',
        node_type: 'list',
        metadata: { recovery_rule: 'mineru_popo_toc_list' },
      },
      ...items,
    ],
  };
}

test('metadata.toc_level overrides conflicting text and bbox hints', () => {
  const levelOne = tocItem(
    'level-one',
    '一、文字正则会判断为二级',
    0.18,
    { toc_level: 1, toc_level_source: 'llm_structure_refinement' },
  );
  const levelTwo = tocItem(
    'level-two',
    '第二章 文字正则会判断为一级',
    0.08,
    { toc_level: 2, toc_level_source: 'llm_structure_refinement' },
  );

  const layout = Integration.tocLayout(tocPage([levelOne, levelTwo]));

  assert.equal(layout.indentByNodeId.get('level-one'), 0);
  assert.equal(layout.indentSourceByNodeId.get('level-one'), 'metadata.toc_level');
  assert.equal(layout.tocLevelByNodeId.get('level-one'), 1);
  assert.equal(layout.indentByNodeId.get('level-two'), 5);
  assert.equal(layout.indentSourceByNodeId.get('level-two'), 'metadata.toc_level');
  assert.equal(layout.tocLevelByNodeId.get('level-two'), 2);
});

test('falls back to bbox before legacy text patterns when canonical level is absent', () => {
  const minimumLeft = tocItem('minimum-left', '一、文字二级', 0.08);
  const coordinate = tocItem('coordinate', '第三章 文字一级', 0.16);

  const layout = Integration.tocLayout(tocPage([minimumLeft, coordinate]));

  assert.equal(layout.indentByNodeId.get('minimum-left'), 5);
  assert.equal(layout.indentSourceByNodeId.get('minimum-left'), 'legacy_text_pattern');
  assert.equal(layout.indentByNodeId.get('coordinate'), 8);
  assert.equal(layout.indentSourceByNodeId.get('coordinate'), 'bbox');
});

test('maps deeper canonical levels deterministically and rejects invalid metadata', () => {
  assert.equal(Integration.tocLevelIndentPercent(1), 0);
  assert.equal(Integration.tocLevelIndentPercent(2), 5);
  assert.equal(Integration.tocLevelIndentPercent(3), 8);
  assert.equal(Integration.tocLevelIndentPercent(4), 11);
  assert.equal(Integration.tocLevelIndentPercent(12), 20);
  assert.equal(Integration.tocLevelIndentPercent(0), null);
  assert.equal(Integration.tocLevelFromMetadata({ metadata: { toc_level: '2' } }), null);
  assert.equal(Integration.tocLevelFromMetadata({ metadata: { toc_level: 13 } }), null);
});
