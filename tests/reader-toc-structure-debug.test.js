const test = require('node:test');
const assert = require('node:assert/strict');

const Integration = require('../reader-semantic-page-integration.js');

function anchor(left, top, right, bottom) {
  return { kind: 'spatial', source_unit_id: 'pdf-page:000002', normalized_bbox: [left, top, right, bottom] };
}

function tocPage() {
  const sharedAnchor = anchor(0.08, 0.18, 0.84, 0.82);
  return {
    presentation_id: 'semantic-page:pdf-page:000002',
    kind: 'semantic_full_page',
    source_unit_id: 'pdf-page:000002',
    source_order: 1,
    source_unit: {
      source_unit_id: 'pdf-page:000002',
      kind: 'physical_page',
      dimensions: { width: 883, height: 1313, unit: 'pixel' },
    },
    nodes: [
      {
        node_id: 'toc-heading',
        node_type: 'heading',
        text: '目录',
        parent_ref: null,
        location: { source_anchor: anchor(0.4, 0.08, 0.6, 0.13) },
        metadata: { recovery_rule: 'mineru_popo_heading' },
      },
      {
        node_id: 'toc-list',
        node_type: 'list',
        text: null,
        parent_ref: null,
        source_anchors: [sharedAnchor],
        metadata: { recovery_rule: 'mineru_popo_toc_list' },
      },
      {
        node_id: 'toc-item-0',
        node_type: 'list_item',
        text: '一、文字模式故意冲突……1',
        parent_ref: 'toc-list',
        source_unit_ids: ['pdf-page:000002'],
        source_anchors: [sharedAnchor],
        metadata: {
          recovery_engine: 'mineru_popo_v2',
          recovery_rule: 'mineru_popo_toc_item',
          toc_level: 1,
          toc_level_source: 'llm_structure_refinement',
        },
      },
      {
        node_id: 'toc-item-1',
        node_type: 'list_item',
        text: '第二章 文字模式故意冲突……1',
        parent_ref: 'toc-list',
        source_unit_ids: ['pdf-page:000002'],
        source_anchors: [sharedAnchor],
        metadata: {
          recovery_engine: 'mineru_popo_v2',
          recovery_rule: 'mineru_popo_toc_item',
          toc_level: 2,
          toc_level_source: 'llm_structure_refinement',
        },
      },
    ],
  };
}

function fakeDocument() {
  function createElement(tag) {
    return {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      dataset: {},
      style: {},
      children: [],
      open: false,
      appendChild(child) { this.children.push(child); return child; },
    };
  }
  return { createElement };
}

test('TOC debug payload exposes canonical levels, fallback values, and final sources', () => {
  const page = tocPage();
  const payload = Integration.tocDebugPayload(page);
  assert.equal(payload.diagnostic_version, 'reader_toc_structure_debug_v2');
  assert.equal(payload.page.source_unit_id, 'pdf-page:000002');
  assert.equal(payload.structural_lists[0].raw_node.node_id, 'toc-list');
  assert.equal(payload.toc_items.length, 2);
  assert.equal(payload.toc_items[1].raw_node.parent_ref, 'toc-list');
  assert.deepEqual(payload.toc_items[1].frontend_bbox, [0.08, 0.18, 0.84, 0.82]);
  assert.equal(payload.toc_items[1].raw_node.metadata.recovery_rule, 'mineru_popo_toc_item');
  assert.equal(payload.toc_items[0].metadata_toc_level, 1);
  assert.equal(payload.toc_items[0].current_text_fallback_indent_percent, 5);
  assert.equal(payload.toc_items[0].final_frontend_indent_percent, 0);
  assert.equal(payload.toc_items[0].final_frontend_indent_source, 'metadata.toc_level');
  assert.equal(payload.toc_items[1].metadata_toc_level, 2);
  assert.equal(payload.toc_items[1].current_text_fallback_indent_percent, 0);
  assert.equal(payload.toc_items[1].final_frontend_indent_percent, 5);
  assert.equal(payload.toc_items[1].final_frontend_indent_source, 'metadata.toc_level');
  assert.equal(payload.derived_layout.indent_source_by_node_id['toc-item-1'], 'metadata.toc_level');
});

test('TOC debug panel renders an open, escaped JSON diagnostics block', () => {
  const panel = Integration.renderTocDebugPanel(fakeDocument(), tocPage(), Integration.tocLayout(tocPage()));
  assert.equal(panel.tagName, 'DETAILS');
  assert.equal(panel.open, true);
  assert.equal(panel.children[0].textContent, 'TOC 完整结构数据（临时调试）');
  assert.equal(panel.children[1].dataset.readerTocDebug, 'true');
  assert.match(panel.children[1].textContent, /"raw_node"/);
  assert.match(panel.children[1].textContent, /"source_anchors"/);
  assert.match(panel.children[1].textContent, /"final_frontend_indent_source"/);
});
