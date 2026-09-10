const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const SourceRendering = require('../reader-chapter-divider-source-rendering.js');

const FULL_PAGE_KINDS = [
  'title_page',
  'back_cover',
  'chapter_divider',
  'full_page_figure',
  'full_page_chart',
];

function carrier(pageKind = 'chapter_divider', overrides = {}) {
  return {
    node_id: `${pageKind}-1`,
    node_type: 'heading',
    text: pageKind,
    source_unit_ids: ['pdf-page:000008'],
    asset_refs: ['legacy-asset'],
    metadata: {
      page_kind: pageKind,
      presentation_mode: 'source_rendering',
      source_rendering_asset_id: 'source-page-asset',
    },
    ...overrides,
  };
}

test('recognizes explicit full-page presentation source roles and rejects ordinary figures', () => {
  for (const pageKind of FULL_PAGE_KINDS) {
    assert.equal(
      SourceRendering.isFullPageSourceRenderingNode(carrier(pageKind)),
      true,
      pageKind,
    );
  }
  assert.equal(SourceRendering.isFullPageSourceRenderingNode(carrier('figure')), false);
  assert.equal(SourceRendering.isFullPageSourceRenderingNode(carrier('paragraph')), false);
  assert.equal(SourceRendering.isFullPageSourceRenderingNode(carrier('title_page', {
    metadata: { page_kind: 'title_page', presentation_mode: 'semantic', source_rendering_asset_id: 'a' },
  })), false);
  assert.equal(SourceRendering.isFullPageSourceRenderingNode(carrier('back_cover', {
    metadata: { page_kind: 'back_cover', presentation_mode: 'source_rendering', source_rendering_asset_id: '' },
  })), false);
});

test('recovers source-rendering asset_refs only for authoritative skipped presentation images', () => {
  const projected = carrier('back_cover', {
    asset_refs: ['back-cover-source'],
    metadata: {
      page_kind: 'back_cover',
      presentation_mode: 'source_rendering',
      ocr_route: 'skipped_presentation_image',
    },
  });
  assert.equal(SourceRendering.sourceRenderingAssetId(projected), 'back-cover-source');
  assert.equal(SourceRendering.isFullPageSourceRenderingNode(projected), true);

  const ordinary = carrier('back_cover', {
    asset_refs: ['ordinary-figure'],
    metadata: {
      page_kind: 'back_cover',
      presentation_mode: 'source_rendering',
      ocr_route: 'ordinary_ocr',
    },
  });
  assert.equal(SourceRendering.sourceRenderingAssetId(ordinary), '');
  assert.equal(SourceRendering.isFullPageSourceRenderingNode(ordinary), false);
});

test('keeps the chapter-divider compatibility alias scoped to chapter dividers', () => {
  assert.equal(SourceRendering.isChapterDividerSourceRenderingNode(carrier('chapter_divider')), true);
  assert.equal(SourceRendering.isChapterDividerSourceRenderingNode(carrier('title_page')), false);
});

test('converts every supported page kind to the existing Cover full-page renderer while preserving actual kind', () => {
  for (const pageKind of FULL_PAGE_KINDS) {
    const sourceCarrier = carrier(pageKind);
    const page = {
      presentation_id: `semantic-page:${pageKind}`,
      kind: 'semantic_full_page',
      source_unit_id: 'pdf-page:000008',
      source_order: 7,
      nodes: [sourceCarrier, { node_id: 'extra-text', node_type: 'paragraph', text: 'duplicate OCR text' }],
      elements: [{ node_id: sourceCarrier.node_id }, { node_id: 'extra-text' }],
    };

    const result = SourceRendering.sourceRenderingCompatibilityPage(page, sourceCarrier);

    assert.equal(result.page_kind, 'cover', pageKind);
    assert.equal(result.presentation_actual_page_kind, pageKind, pageKind);
    assert.equal(result.presentation_mode, 'source_rendering', pageKind);
    assert.equal(result.nodes.length, 1, pageKind);
    assert.equal(result.elements.length, 0, pageKind);
    assert.equal(result.nodes[0].metadata.page_kind, 'cover', pageKind);
    assert.equal(result.nodes[0].metadata.presentation_actual_page_kind, pageKind, pageKind);
    assert.deepEqual(result.nodes[0].asset_refs, ['source-page-asset'], pageKind);
    assert.equal(page.nodes.length, 2, pageKind);
    assert.equal(sourceCarrier.metadata.page_kind, pageKind, pageKind);
  }
});

test('finds a presentation carrier by physical page identity even when it is not in page.nodes', () => {
  const sourceCarrier = carrier('title_page', {
    source_unit_ids: [],
    metadata: {
      page_kind: 'title_page',
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

  assert.equal(SourceRendering.sourceRenderingCarrier(page, [sourceCarrier]), sourceCarrier);
});

test('finds back-cover source carrier in semantic page elements when page.nodes omits it', () => {
  const projectedCarrier = carrier('back_cover', {
    asset_refs: ['back-cover-source'],
    metadata: {
      page_kind: 'back_cover',
      presentation_mode: 'source_rendering',
      ocr_route: 'skipped_presentation_image',
    },
  });
  const page = {
    presentation_id: 'semantic-page:back-cover',
    source_unit_id: 'pdf-page:000011',
    source_order: 10,
    nodes: [{ node_id: 'back-cover-text', node_type: 'paragraph', text: 'OCR sibling' }],
    elements: [
      { element_id: 'back-cover-rendering', node_id: projectedCarrier.node_id, node: projectedCarrier },
      { element_id: 'ocr-text', node_id: 'back-cover-text' },
    ],
  };

  assert.equal(SourceRendering.sourceRenderingCarrier(page, []), projectedCarrier);
  const result = SourceRendering.sourceRenderingCompatibilityPage(page, projectedCarrier);
  assert.equal(result.presentation_actual_page_kind, 'back_cover');
  assert.equal(result.nodes.length, 1);
  assert.equal(result.elements.length, 0);
  assert.deepEqual(result.nodes[0].asset_refs, ['back-cover-source']);
  assert.equal(result.nodes[0].metadata.source_rendering_asset_id, 'back-cover-source');
});

test('installed wrapper feeds all supported presentation pages through Cover layout and restores canonical state', () => {
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
  assert.equal(SourceRendering.install(root), true);

  const originalPages = FULL_PAGE_KINDS.map((pageKind, index) => ({
    presentation_id: `semantic-page:${pageKind}`,
    kind: 'semantic_full_page',
    source_unit_id: `pdf-page:${String(index + 1).padStart(6, '0')}`,
    nodes: [carrier(pageKind, { source_unit_ids: [`pdf-page:${String(index + 1).padStart(6, '0')}`] })],
    elements: [{ node_id: `${pageKind}-1` }],
  }));
  const originalState = { mode: 'semantic_full_page', pages: originalPages };
  const controller = new Controller();
  controller.nodes = originalPages.flatMap((page) => page.nodes);
  controller.presentationState = originalState;
  controller.element = () => null;

  assert.equal(controller.renderPages(), 'rendered');
  assert.notEqual(observedState, originalState);
  for (let index = 0; index < FULL_PAGE_KINDS.length; index += 1) {
    assert.equal(observedState.pages[index].nodes[0].metadata.page_kind, 'cover');
    assert.equal(
      observedState.pages[index].nodes[0].metadata.presentation_actual_page_kind,
      FULL_PAGE_KINDS[index],
    );
  }
  assert.equal(controller.presentationState, originalState);
});

test('ordinary semantic pages are left untouched', () => {
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
  SourceRendering.install(root);

  const originalState = {
    mode: 'semantic_full_page',
    pages: [{
      presentation_id: 'semantic-page:body',
      source_unit_id: 'pdf-page:000010',
      nodes: [carrier('figure', { source_unit_ids: ['pdf-page:000010'] })],
      elements: [],
    }],
  };
  const controller = new Controller();
  controller.nodes = originalState.pages[0].nodes;
  controller.presentationState = originalState;
  controller.element = () => null;

  controller.renderPages();
  assert.equal(observedState, originalState);
});

test('main page loads the presentation source-rendering compatibility module and syntax check includes it', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(html, /reader-chapter-divider-source-rendering\.js/);
  assert.ok(html.indexOf('reader-presentation.js') < html.indexOf('reader-chapter-divider-source-rendering.js'));
  assert.ok(html.indexOf('reader-chapter-divider-source-rendering.js') < html.indexOf('app.js'));
  assert.match(packageJson.scripts.check, /node --check reader-chapter-divider-source-rendering\.js/);
});
