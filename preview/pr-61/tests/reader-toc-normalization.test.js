const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Integration = require('../reader-semantic-page-integration.js');

function fakeDocument() {
  function element(tag) {
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
  return { createElement: element };
}

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

test('renders toc items in normalized flow while omitting the structural list carrier', () => {
  const document = fakeDocument();
  const controller = {
    document,
    renderNode(node) {
      const rendered = document.createElement('article');
      rendered.dataset.readerNodeId = node.node_id;
      rendered.textContent = node.text || '';
      return rendered;
    },
  };
  const section = Integration.renderNormalizedTocPage(controller, tocPage());
  assert.match(section.className, /reader-v2-page--normalized-toc/);
  const shell = section.children[1];
  assert.equal(shell.style.aspectRatio, String(883 / 1313));
  const flow = shell.children[0];
  assert.equal(flow.className, 'reader-v2-semantic-page-toc');
  assert.equal(flow.children.length, 5);
  assert.match(flow.children[0].className, /reader-v2-semantic-page-toc-heading/);
  assert.match(flow.children[1].className, /reader-v2-semantic-page-toc-item/);
  assert.equal(flow.children.some((child) => child.dataset.readerNodeId === 'toc-list'), false);
});

test('toc CSS uses a stable safe content region and normalized typography', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'reader-semantic-page.css'), 'utf8');
  assert.match(css, /\.reader-v2-semantic-page-toc\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*8% 8\.5% 7%;/s);
  assert.match(css, /\.reader-v2-semantic-page-toc-heading\s*\{[^}]*text-align:\s*center;/s);
  assert.match(css, /\.reader-v2-semantic-page-toc-item\s*\{[^}]*font-size:\s*clamp\(/s);
});