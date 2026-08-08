const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ChapterDivider = require('../reader-chapter-divider-source-rendering.js');

function carrier(overrides = {}) {
  return {
    node_id: 'chapter-divider-1',
    node_type: 'heading',
    text: '上篇',
    source_unit_ids: ['pdf-page:000008'],
    asset_refs: ['legacy-asset'],
    metadata: {
      page_kind: 'chapter_divider',
      presentation_mode: 'source_rendering',
      source_rendering_asset_id: 'source-page-asset',
    },
    ...overrides,
  };
}

test('recognizes only explicit chapter-divider source rendering carriers', () => {
  assert.equal(ChapterDivider.isChapterDividerSourceRenderingNode(carrier()), true);
  assert.equal(ChapterDivider.isChapterDividerSourceRenderingNode(carrier({
    metadata: { page_kind: 'cover', presentation_mode: 'source_rendering', source_rendering_asset_id: 'a' },
  })), false);
  assert.equal(ChapterDivider.isChapterDividerSourceRenderingNode(carrier({
    metadata: { page_kind: 'chapter_divider', presentation_mode: 'semantic', source_rendering_asset_id: 'a' },
  })), false);
});

test('converts chapter divider to the existing cover full-page renderer without losing actual page kind', () => {
  const sourceCarrier = carrier();
  const page = {
    presentation_id: 'semantic-page:pdf-page:000008',
    kind: 'semantic_full_page',
    source_unit_id: 'pdf-page:000008',
    source_order: 7,
    nodes: [sourceCarrier, { node_id: 'extra-text', node_type: 'paragraph', text: 'duplicate OCR text' }],
    elements: [{ node_id: 'chapter-divider-1' }, { node_id: 'extra-text' }],
  };

  const result = ChapterDivider.chapterDividerCompatibilityPage(page, sourceCarrier);

  assert.equal(result.page_kind, 'cover');
  assert.equal(result.presentation_actual_page_kind, 'chapter_divider');
  assert.equal(result.presentation_mode, 'source_rendering');
  assert.equal(result.nodes.length, 1);
  assert.equal(result.elements.length, 0);
  assert.equal(result.nodes[0].metadata.page_kind, 'cover');
  assert.equal(result.nodes[0].metadata.presentation_actual_page_kind, 'chapter_divider');
  assert.deepEqual(result.nodes[0].asset_refs, ['source-page-asset']);
  assert.equal(page.nodes.length, 2);
  assert.equal(sourceCarrier.metadata.page_kind, 'chapter_divider');
});

test('finds a chapter divider carrier by physical page identity even when it is not in page.nodes', () => {
  const sourceCarrier = carrier({
    source_unit_ids: [],
    metadata: {
      page_kind: 'chapter_divider',
      presentation_mode: 'source_rendering',
      source_rendering_asset_id: 'source-page-asset',
      page_fragments: [{
        source_anchor: { source_unit_id: 'pdf-page:000008' },
      }],
    },
  });
  const page = {
    presentation_id: 'semantic-page:pdf-page:000008',
    source_unit_id: 'pdf-page:000008',
    nodes: [],
  };

  assert.equal(ChapterDivider.chapterDividerCarrier(page, [sourceCarrier]), sourceCarrier);
});

test('installed wrapper feeds chapter divider through full-page compatibility and restores canonical state', () => {
  function Controller() {}
  let observedState = null;
  Controller.prototype.renderPages = function legacyRenderPages() {
    observedState = this.presentationState;
    return 'rendered';
  };

  const root = {
    ReaderUIV2: { ReaderV2Controller: Controller },
    ReaderSemanticPageIntegrationV2: { installSemanticPageIntegration() {} },
  };
  assert.equal(ChapterDivider.install(root), true);

  const originalState = {
    mode: 'semantic_full_page',
    pages: [{
      presentation_id: 'semantic-page:pdf-page:000008',
      kind: 'semantic_full_page',
      source_unit_id: 'pdf-page:000008',
      nodes: [carrier()],
      elements: [{ node_id: 'chapter-divider-1' }],
    }],
  };
  const controller = new Controller();
  controller.nodes = originalState.pages[0].nodes;
  controller.presentationState = originalState;
  controller.element = () => null;

  assert.equal(controller.renderPages(), 'rendered');
  assert.notEqual(observedState, originalState);
  assert.equal(observedState.pages[0].nodes[0].metadata.page_kind, 'cover');
  assert.equal(observedState.pages[0].nodes[0].metadata.presentation_actual_page_kind, 'chapter_divider');
  assert.equal(controller.presentationState, originalState);
});

test('main page loads chapter-divider source rendering and syntax check includes it', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(html, /reader-chapter-divider-source-rendering\.js/);
  assert.ok(html.indexOf('reader-presentation.js') < html.indexOf('reader-chapter-divider-source-rendering.js'));
  assert.ok(html.indexOf('reader-chapter-divider-source-rendering.js') < html.indexOf('app.js'));
  assert.match(packageJson.scripts.check, /node --check reader-chapter-divider-source-rendering\.js/);
});
