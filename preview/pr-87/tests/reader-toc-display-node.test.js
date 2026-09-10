const test = require('node:test');
const assert = require('node:assert/strict');

const Integration = require('../reader-semantic-page-integration.js');

function fakeElement(tag) {
  return {
    tagName: tag.toUpperCase(),
    className: '',
    textContent: '',
    dataset: {},
    style: {},
    children: [],
    appendChild(child) { this.children.push(child); return child; },
  };
}

function tocPage() {
  return {
    presentation_id: 'semantic-page:toc',
    source_unit_id: 'pdf-page:000001',
    source_order: 0,
    source_unit: { dimensions: { width: 888, height: 1226, unit: 'pixel' } },
    nodes: [
      {
        node_id: 'toc-heading',
        node_type: 'heading',
        text: '目录',
        metadata: { recovery_rule: 'mineru_popo_heading' },
      },
      {
        node_id: 'toc-list',
        node_type: 'list',
        metadata: { recovery_rule: 'mineru_popo_toc_list' },
      },
      {
        node_id: 'toc-item-1',
        node_type: 'list_item',
        text: '一、趋势交易法流程..... 1',
        metadata: {
          recovery_rule: 'mineru_popo_toc_item',
          toc_level: 2,
          toc_level_source: 'llm_structure_refinement',
        },
      },
    ],
  };
}

test('creates a presentation-only paragraph without mutating the canonical toc node', () => {
  const item = tocPage().nodes[2];
  const displayNode = Integration.tocDisplayNode(item);

  assert.equal(item.node_type, 'list_item');
  assert.equal(displayNode.node_type, 'paragraph');
  assert.equal(displayNode.node_id, item.node_id);
  assert.equal(displayNode.presentation_canonical_node_id, item.node_id);
  assert.equal(displayNode.presentation_original_node_type, 'list_item');
  assert.equal(displayNode.presentation_role, 'toc_item');
  assert.equal(displayNode.metadata, item.metadata);
});

test('normalized toc rendering sends paragraph nodes to the generic renderer', () => {
  const renderedNodeTypes = [];
  const document = { createElement: fakeElement };
  const controller = {
    document,
    renderNode(node) {
      renderedNodeTypes.push([node.node_id, node.node_type]);
      const wrapper = fakeElement('article');
      wrapper.dataset.readerNodeId = node.node_id;
      wrapper.appendChild(fakeElement(node.node_type === 'paragraph' ? 'p' : 'li'));
      return wrapper;
    },
  };

  const section = Integration.renderNormalizedTocPage(controller, tocPage());
  const flow = section.children[1].children[0];
  const renderedItem = flow.children[1];

  assert.deepEqual(renderedNodeTypes, [
    ['toc-heading', 'heading'],
    ['toc-item-1', 'paragraph'],
  ]);
  assert.equal(renderedItem.dataset.readerNodeId, 'toc-item-1');
  assert.equal(renderedItem.dataset.readerOriginalNodeType, 'list_item');
  assert.equal(renderedItem.children[0].tagName, 'P');
});
