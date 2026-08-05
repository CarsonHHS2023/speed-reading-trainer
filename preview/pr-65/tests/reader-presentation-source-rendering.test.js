const test = require('node:test');
const assert = require('node:assert/strict');

const Presentation = require('../reader-presentation-source-rendering.js');

function presentationNode(pageKind = 'chapter_divider') {
  return {
    node_id: `presentation:${pageKind}`,
    node_type: 'figure',
    text: null,
    source_unit_ids: ['pdf-page:000003'],
    asset_refs: ['presentation-asset'],
    metadata: {
      page_kind: pageKind,
      presentation_mode: 'source_rendering',
      source_rendering_asset_id: 'presentation-asset',
      source_pdf_kind: 'geometry_selected_pdf',
      ocr_route: 'skipped_presentation_image',
      page_classification: {
        page_role: pageKind,
        confidence: 0.97,
        reason_codes: ['large_centered_title'],
      },
      opencv_page_preprocessing: {
        route: 'presentation_geometry_only',
        selected: 'geometry',
      },
      geometry: { accepted: true },
      background: {
        attempted: false,
        reason: 'presentation_page_background_skipped',
      },
    },
  };
}

test('all configured presentation roles are recognized from backend metadata', () => {
  for (const pageKind of Presentation.PRESENTATION_ROLES) {
    assert.equal(
      Presentation.isPresentationSourceRenderingNode(presentationNode(pageKind)),
      true,
      pageKind,
    );
  }
});

test('ordinary figures are not promoted from appearance alone', () => {
  assert.equal(Presentation.isPresentationSourceRenderingNode({
    node_id: 'ordinary-figure',
    node_type: 'figure',
    asset_refs: ['figure-asset'],
    metadata: { page_kind: 'full_page_figure' },
  }), false);
});

test('presentation page becomes one semantic full-page carrier without changing navigation identity', () => {
  const carrier = presentationNode('chapter_divider');
  const page = {
    presentation_id: 'semantic-page:pdf-page:000003',
    kind: 'physical_page',
    source_order: 2,
    source_unit_id: 'pdf-page:000003',
    source_unit: { width: 612, height: 792 },
    nodes: [
      carrier,
      { node_id: 'scattered-title', node_type: 'heading', text: 'Chapter 3' },
    ],
    elements: [{ node_id: 'scattered-title' }],
  };

  const rendered = Presentation.semanticCompatibilityPage(page);

  assert.equal(rendered.kind, 'semantic_full_page');
  assert.equal(rendered.presentation_id, page.presentation_id);
  assert.equal(rendered.source_order, 2);
  assert.equal(rendered.source_unit_id, page.source_unit_id);
  assert.equal(rendered.nodes.length, 1);
  assert.equal(rendered.nodes[0].node_id, carrier.node_id);
  assert.equal(rendered.nodes[0].metadata.page_kind, 'cover');
  assert.equal(rendered.nodes[0].metadata.presentation_actual_page_kind, 'chapter_divider');
  assert.equal(carrier.metadata.page_kind, 'chapter_divider');
  assert.equal(page.nodes.length, 2);
});

test('classification audit exposes Reader debug fields', () => {
  const audit = Presentation.classificationAudit(presentationNode('full_page_chart'));
  assert.deepEqual(audit, {
    page_kind: 'full_page_chart',
    confidence: 0.97,
    reason_codes: ['large_centered_title'],
    ocr_route: 'skipped_presentation_image',
    geometry_route: 'presentation_geometry_only',
    geometry_selected: 'geometry',
    geometry_accepted: true,
    background_attempted: false,
    background_reason: 'presentation_page_background_skipped',
    source_rendering_asset_id: 'presentation-asset',
  });
});

test('presentation source units and all same-page siblings are removed from speed reading', () => {
  const body = {
    node_id: 'body',
    node_type: 'paragraph',
    text: 'Readable body text',
    source_unit_ids: ['pdf-page:000004'],
    metadata: {},
  };
  const samePageHeading = {
    node_id: 'same-page-heading',
    node_type: 'heading',
    text: 'Hidden title text',
    source_unit_ids: ['pdf-page:000003'],
    metadata: {},
  };
  const samePageParagraph = {
    node_id: 'same-page-paragraph',
    node_type: 'paragraph',
    text: 'Hidden OCR text',
    location: { source_unit_id: 'pdf-page:000003' },
    metadata: {},
  };
  const presentation = presentationNode('title_page');
  const fakeAdapter = {
    buildReadingElements(_documentView, nodes) {
      return nodes.map((node) => node.node_id);
    },
    buildPlaybackFrames(_documentView, nodes) {
      return { nodeIds: nodes.map((node) => node.node_id) };
    },
  };

  assert.equal(Presentation.installSpeedReadingPatch(fakeAdapter), true);
  assert.deepEqual(
    fakeAdapter.buildReadingElements({}, [presentation, samePageHeading, samePageParagraph, body]),
    ['body'],
  );
  assert.deepEqual(
    fakeAdapter.buildPlaybackFrames({}, [presentation, samePageHeading, samePageParagraph, body]),
    { nodeIds: ['body'] },
  );
  assert.equal(Presentation.installSpeedReadingPatch(fakeAdapter), true);
});

test('page fragment source units suppress hidden same-page playback nodes', () => {
  const directFragmentCarrier = presentationNode('cover');
  delete directFragmentCarrier.source_unit_ids;
  directFragmentCarrier.metadata.page_fragments = [
    { source_unit_id: 'pdf-page:000005', text: '' },
  ];

  const anchoredFragmentCarrier = presentationNode('back_cover');
  delete anchoredFragmentCarrier.source_unit_ids;
  anchoredFragmentCarrier.metadata.page_fragments = [
    {
      text: '',
      source_anchor: {
        kind: 'spatial',
        source_unit_id: 'pdf-page:000006',
        normalized_bbox: [0, 0, 1, 1],
      },
    },
  ];

  const directSibling = {
    node_id: 'fragment-page-heading',
    node_type: 'heading',
    text: 'Hidden fragment heading',
    source_unit_ids: ['pdf-page:000005'],
    metadata: {},
  };
  const anchoredSibling = {
    node_id: 'fragment-page-paragraph',
    node_type: 'paragraph',
    text: 'Hidden fragment paragraph',
    metadata: {
      page_fragments: [
        {
          source_anchor: { source_unit_id: 'pdf-page:000006' },
          text: 'Hidden fragment paragraph',
        },
      ],
    },
  };
  const unrelated = {
    node_id: 'ordinary-body',
    node_type: 'paragraph',
    text: 'Keep me',
    source_unit_ids: ['pdf-page:000007'],
    metadata: {},
  };

  assert.deepEqual(
    Presentation.filteredPlaybackNodes([
      directFragmentCarrier,
      anchoredFragmentCarrier,
      directSibling,
      anchoredSibling,
      unrelated,
    ]),
    [unrelated],
  );
});

test('nodes on unrelated source units remain eligible for playback', () => {
  const presentation = presentationNode('cover');
  const unrelated = {
    node_id: 'unrelated-body',
    node_type: 'paragraph',
    text: 'Keep me',
    source_unit_ids: ['pdf-page:000004'],
    metadata: {},
  };

  assert.deepEqual(
    Presentation.filteredPlaybackNodes([presentation, unrelated]),
    [unrelated],
  );
});

test('page carrier lookup does not alter ordinary pages', () => {
  const page = {
    presentation_id: 'ordinary',
    kind: 'physical_page',
    nodes: [{ node_id: 'body', node_type: 'paragraph', text: 'Body', metadata: {} }],
  };
  assert.equal(Presentation.presentationCarrier(page), null);
  assert.equal(Presentation.semanticCompatibilityPage(page), page);
});
