const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Integration = require('../reader-semantic-page-integration.js');

function tocPage({ withHeading = true, itemCount = 4 } = {}) {
  const heading = {
    node_id: 'toc-heading',
    node_type: 'heading',
    text: '目录',
    metadata: { recovery_rule: 'mineru_popo_heading' },
  };
  const list = {
    node_id: 'toc-list',
    node_type: 'list',
    text: null,
    metadata: { recovery_rule: 'mineru_popo_toc_list' },
  };
  const items = Array.from({ length: itemCount }, (_, index) => ({
    node_id: `toc-item-${index}`,
    node_type: 'list_item',
    text: `第${index + 1}章…… ${index + 1}`,
    metadata: { recovery_rule: 'mineru_popo_toc_item' },
  }));
  return {
    presentation_id: 'semantic-page:toc',
    source_unit_id: 'pdf-page:000002',
    source_order: 1,
    source_unit: { dimensions: { width: 883, height: 1313, unit: 'pixel' } },
    nodes: [...(withHeading ? [heading] : []), list, ...items],
  };
}

test('detects toc starts, continuation pages, and short final toc pages', () => {
  assert.equal(Integration.isNormalizedTocPage(tocPage({ withHeading: true, itemCount: 1 })), true);
  assert.equal(Integration.isNormalizedTocPage(tocPage({ withHeading: false, itemCount: 4 })), true);
  assert.equal(Integration.isNormalizedTocPage(tocPage({ withHeading: false, itemCount: 1 })), false);
  assert.equal(Integration.isNormalizedTocPage(tocPage({ withHeading: false, itemCount: 1 }), true), true);
  assert.equal(Integration.isNormalizedTocPage({ ...tocPage(), page_kind: 'cover' }, true), false);
  assert.equal(Integration.isNormalizedTocPage(tocPage({ withHeading: false, itemCount: 0 }), true), false);
});

test('separates optional toc heading, item nodes, and structural list carrier', () => {
  const headed = Integration.tocParts(tocPage());
  assert.equal(headed.heading.node_id, 'toc-heading');
  assert.deepEqual(headed.items.map((node) => node.node_id), [
    'toc-item-0',
    'toc-item-1',
    'toc-item-2',
    'toc-item-3',
  ]);
  assert.equal(headed.listNodeIds.has('toc-list'), true);

  const continuation = Integration.tocParts(tocPage({ withHeading: false, itemCount: 2 }));
  assert.equal(continuation.heading, null);
  assert.equal(continuation.items.length, 2);
});

test('renders a continuation toc page without requiring a heading node', () => {
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
  const document = { createElement: fakeElement };
  const controller = {
    document,
    renderNode(node) {
      const rendered = fakeElement('article');
      rendered.dataset.readerNodeId = node.node_id;
      rendered.textContent = node.text || '';
      return rendered;
    },
  };
  const section = Integration.renderNormalizedTocPage(
    controller,
    tocPage({ withHeading: false, itemCount: 2 }),
  );
  const flow = section.children[1].children[0];
  assert.match(flow.className, /reader-v2-semantic-page-toc--continuation/);
  assert.equal(flow.children.length, 2);
  assert.equal(flow.children[0].dataset.readerNodeId, 'toc-item-0');
});

test('toc CSS uses a stable safe content region and normalized typography', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'reader-semantic-page.css'), 'utf8');
  assert.match(css, /\.reader-v2-semantic-page-toc\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*8% 8\.5% 7%;/s);
  assert.match(css, /\.reader-v2-semantic-page-toc-heading\s*\{[^}]*text-align:\s*center;/s);
  assert.match(css, /\.reader-v2-semantic-page-toc-item\s*\{[^}]*font-size:\s*clamp\(/s);
});