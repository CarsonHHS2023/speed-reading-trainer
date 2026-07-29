const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Integration = require('../reader-semantic-page-integration.js');

function tocPage() {
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
  const items = Array.from({ length: 4 }, (_, index) => ({
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
    nodes: [heading, list, ...items],
  };
}

test('detects only semantic pages with a toc heading and recovered toc items', () => {
  const page = tocPage();
  assert.equal(Integration.isNormalizedTocPage(page), true);
  assert.equal(Integration.isNormalizedTocPage({ ...page, nodes: page.nodes.slice(0, 3) }), false);
  assert.equal(Integration.isNormalizedTocPage({ ...page, page_kind: 'cover' }), false);
});

test('separates toc heading, item nodes, and the structural list carrier', () => {
  const parts = Integration.tocParts(tocPage());
  assert.equal(parts.heading.node_id, 'toc-heading');
  assert.deepEqual(parts.items.map((node) => node.node_id), [
    'toc-item-0',
    'toc-item-1',
    'toc-item-2',
    'toc-item-3',
  ]);
  assert.equal(parts.listNodeIds.has('toc-list'), true);
});

test('toc CSS uses a stable safe content region and normalized typography', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'reader-semantic-page.css'), 'utf8');
  assert.match(css, /\.reader-v2-semantic-page-toc\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*8% 8\.5% 7%;/s);
  assert.match(css, /\.reader-v2-semantic-page-toc-heading\s*\{[^}]*text-align:\s*center;/s);
  assert.match(css, /\.reader-v2-semantic-page-toc-item\s*\{[^}]*font-size:\s*clamp\(/s);
});