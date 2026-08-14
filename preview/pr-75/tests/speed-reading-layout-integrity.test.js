const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Integrity = require('../speed-reading-layout-integrity.js');

function importantStyle(initial = {}) {
  const values = { ...initial };
  const priorities = {};
  return {
    ...initial,
    setProperty(name, value, priority = '') {
      values[name] = value;
      priorities[name] = priority;
      const camel = name.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
      this[camel] = value;
    },
    value(name) { return values[name]; },
    priority(name) { return priorities[name] || ''; },
  };
}

test('line mode keeps complete configured groups across virtual-page boundaries and only leaves true tail remainders', () => {
  assert.equal(Integrity.lineFrameCapacity(7, 3), 6);
  assert.equal(Integrity.lineFrameCapacity(8, 3), 6);
  assert.equal(Integrity.lineFrameCapacity(9, 3), 9);
  assert.equal(Integrity.lineFrameCapacity(2, 3), 2);
  assert.equal(Integrity.lineFrameCapacity(7, 1), 7);
});

test('direct Reader v2 caption relation binds on the same page and explicit cross-page relations are rejected', () => {
  const adapter = {
    resolvedTypeForNode(node) { return { type: node.node_type }; },
  };
  const nodes = [
    { node_id: 'figure-1', node_type: 'figure', order: 1, location: { source_unit_id: 'page-1' } },
    {
      node_id: 'caption-same-page', node_type: 'caption', parent_ref: 'figure-1', text: '图 1-1 正确标题', order: 2,
      location: { source_unit_id: 'page-1' },
    },
    { node_id: 'figure-2', node_type: 'figure', order: 3, location: { source_unit_id: 'page-1' } },
    {
      node_id: 'caption-cross-page', node_type: 'caption', parent_ref: 'figure-2', text: '另一页标题', order: 4,
      location: { source_unit_id: 'page-2' },
    },
    {
      node_id: 'caption-unbound', node_type: 'caption', text: '没有关系也没有坐标证据', order: 5,
      location: { source_unit_id: 'page-1' },
    },
  ];

  const result = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.deepEqual(result.byParent.get('figure-1').map((item) => item.text), ['图 1-1 正确标题']);
  assert.equal(result.consumedCaptionIds.has('caption-same-page'), true);
  assert.equal(result.byParent.has('figure-2'), false);
  assert.equal(result.consumedCaptionIds.has('caption-cross-page'), false);
  assert.equal(result.unresolvedCaptionIds.has('caption-cross-page'), true);
  assert.equal(result.consumedCaptionIds.has('caption-unbound'), false);
});

test('figure and table captions attach only to their explicit canonical parents', () => {
  const adapter = {
    resolvedTypeForNode(node) { return { type: node.node_type }; },
  };
  const associations = Integrity.canonicalCaptionAssociations(adapter, [
    { node_id: 'figure-1', node_type: 'figure', order: 1 },
    { node_id: 'table-1', node_type: 'table', order: 3 },
    { node_id: 'caption-figure', node_type: 'caption', parent_ref: 'figure-1', text: '图 1-1', order: 2 },
    { node_id: 'caption-table', node_type: 'caption', parent_ref: 'table-1', text: '表1 复利的作用', order: 4 },
    { node_id: 'caption-unbound', node_type: 'caption', text: '没有父节点', order: 5 },
  ]);
  const frames = [
    { kind: 'manual', node_type: 'figure', identity: { node_id: 'figure-1' } },
    { kind: 'manual', node_type: 'table', identity: { node_id: 'table-1' } },
  ];

  Integrity.attachVisualCaptions(frames, associations);
  assert.equal(frames[0].caption_text, '图 1-1');
  assert.equal(frames[1].caption_text, '表1 复利的作用');
  assert.equal(associations.consumedCaptionIds.has('caption-unbound'), false);
});

test('playback element policy preserves Reader canonical preorder while suppressing only attached captions', () => {
  const adapter = {
    buildReadingElements() {
      return [
        { kind: 'manual', node_type: 'figure', identity: { node_id: 'figure-1' } },
        { kind: 'text', node_type: 'caption', identity: { node_id: 'caption-1' } },
        { kind: 'text', node_type: 'paragraph', identity: { node_id: 'p-1' } },
        { kind: 'manual', node_type: 'table', identity: { node_id: 'table-1' } },
        { kind: 'text', node_type: 'caption', identity: { node_id: 'caption-2' } },
        { kind: 'text', node_type: 'paragraph', identity: { node_id: 'p-2' } },
      ];
    },
  };

  let captured = null;
  Integrity.withPlaybackElementPolicy(adapter, new Set(['caption-1', 'caption-2']), () => {
    captured = adapter.buildReadingElements();
  });
  assert.deepEqual(captured.map((element) => element.identity.node_id), ['figure-1', 'p-1', 'table-1', 'p-2']);
});

test('associated table caption is removed from timed flow and attached to the table without reordering Reader elements', () => {
  const adapter = {
    resolvedTypeForNode(node) { return { type: node.node_type }; },
    buildReadingElements() {
      return [
        { kind: 'manual', node_type: 'table', text: '', identity: { node_id: 'table-1' }, asset_refs: ['asset-table'] },
        { kind: 'text', node_type: 'caption', text: '表1 复利的作用', identity: { node_id: 'caption-1' } },
        { kind: 'text', node_type: 'paragraph', text: '后续正文', identity: { node_id: 'p-1' } },
      ];
    },
  };
  let capturedElements = null;
  let capturedOptions = null;
  const responsive = {
    DEFAULT_LINE_HEIGHT_RATIO: 1.55,
    DEFAULT_SAFE_GUTTER_PX: 48,
    DEFAULT_SAFE_VERTICAL_GUTTER_PX: 72,
    createCanvasMeasurer() { return () => 10; },
    pageLineCapacity() { return 7; },
    buildMeasuredPlaybackFrames(usedAdapter, _view, _nodes, options) {
      capturedOptions = options;
      capturedElements = usedAdapter.buildReadingElements();
      return {
        frames: [
          {
            kind: 'manual', node_type: 'table', identity: { node_id: 'table-1' },
            placement: { display_scope: 'manual', x_px: 0 },
          },
          {
            kind: 'timed_text', node_type: 'paragraph', identity: { node_id: 'p-1' }, lines: [{ text: '后续正文' }],
            placement: { display_scope: 'line', x_px: 0 },
          },
        ],
        options: {},
      };
    },
  };
  const nodes = [
    { node_id: 'table-1', node_type: 'table', order: 1 },
    { node_id: 'caption-1', node_type: 'caption', parent_ref: 'table-1', text: '表1 复利的作用', order: 2 },
    { node_id: 'p-1', node_type: 'paragraph', text: '后续正文', order: 3 },
  ];
  const playbackContext = { start: 0, firstNodeId: 'table-1', nodes };
  const root = { SpeedReadingAdapter: adapter, SpeedReadingResponsiveLayout: responsive };
  const controller = {
    document: { defaultView: { getComputedStyle() { return { lineHeight: '20px', fontSize: '20px' }; } } },
    reader: { openResponse: { candidate_id: 'cand' } },
    playbackContext() { return playbackContext; },
    updateSettingsVisibility() {},
    applyVisualSettings() {},
    adapterOptions() { return { displayScope: 'line', lineCount: 3, maxLines: 3, maxWidthPx: 300, speedPerMinute: 600 }; },
    displayScope() { return 'line'; },
    playbackAvailableHeight() { return 500; },
    element(id) { return id === 'fontInput' ? { value: '20' } : { clientWidth: 348, clientHeight: 500 }; },
  };

  const built = Integrity.buildIntegrityPlaybackFrames(controller, root, playbackContext);
  assert.equal(capturedOptions.pageLineCapacity, 6);
  assert.deepEqual(capturedElements.map((element) => element.identity.node_id), ['table-1', 'p-1']);
  assert.equal(built.frames[0].caption_text, '表1 复利的作用');
  assert.deepEqual(built.frames[0].caption_node_ids, ['caption-1']);
  assert.equal(built.frames[1].placement.x_px, 24);
  assert.equal(built.options.rawPageLineCapacity, 7);
  assert.equal(built.options.pageLineCapacity, 6);
  assert.equal(built.options.horizontalInsetPx, 24);
});

test('horizontal safety gutter is symmetric by moving measured content origin inward by half the total gutter', () => {
  const frames = [
    { kind: 'timed_text', placement: { display_scope: 'line', x_px: 0 } },
    { kind: 'timed_text', placement: { display_scope: 'block', x_px: 35 } },
    { kind: 'timed_text', placement: { display_scope: 'page', x_px: 10 } },
    { kind: 'manual', placement: { display_scope: 'manual', x_px: 0 } },
  ];
  Integrity.applySafeHorizontalInset(frames, 24);
  assert.equal(frames[0].placement.x_px, 24);
  assert.equal(frames[1].placement.x_px, 59);
  assert.equal(frames[2].placement.x_px, 34);
  assert.equal(frames[3].placement.x_px, 0);
});

test('timed text keeps measured row width authoritative while allowing only bounded glyph bleed', () => {
  const targetStyle = importantStyle({ overflow: 'visible' });
  const containerStyle = importantStyle({ overflow: 'hidden' });
  const structuredStyle = importantStyle({ overflow: 'hidden' });
  const rowStyles = [importantStyle({ overflow: 'visible', width: 'calc(100% + 12px)' }), importantStyle({ overflow: 'visible' })];
  const target = {
    style: targetStyle,
    querySelector(selector) {
      if (selector === '.reader-playback-frame-text') return { style: containerStyle };
      if (selector === '.reader-playback-frame-structured') return { style: structuredStyle };
      return null;
    },
    querySelectorAll(selector) {
      return selector === '.reader-playback-line' ? rowStyles.map((style) => ({ style })) : [];
    },
  };

  assert.equal(Integrity.relaxTimedTextClipping(target), 2);
  assert.equal(targetStyle.value('overflow'), 'hidden');
  assert.equal(targetStyle.priority('overflow'), 'important');
  assert.equal(containerStyle.value('overflow'), 'visible');
  assert.equal(structuredStyle.value('overflow'), 'visible');
  for (const style of rowStyles) {
    assert.equal(style.value('box-sizing'), 'border-box');
    assert.equal(style.value('width'), '100%');
    assert.equal(style.value('max-width'), '100%');
    assert.equal(style.value('margin-inline'), '0');
    assert.equal(style.value('padding-inline'), '0');
    assert.equal(style.value('overflow'), 'clip');
    assert.equal(style.value('overflow-clip-margin'), '6px');
    assert.equal(style.priority('overflow'), 'important');
    assert.equal(style.priority('width'), 'important');
  }
});

test('manual visual caption renderer keeps caption and visual in the same target frame', () => {
  const documentObject = {
    createElement() {
      return { className: '', textContent: '', dataset: {}, style: {} };
    },
  };
  const target = {
    children: [{ className: 'reader-playback-asset-slot' }],
    prepend(node) { this.children.unshift(node); },
  };
  const controller = { document: documentObject };
  const rendered = Integrity.prependVisualCaptions(controller, {
    kind: 'manual',
    node_type: 'figure',
    captions: [{ node_id: 'caption-1', text: '图 1-1 印度 GDP 变化图' }],
  }, target);

  assert.equal(rendered, true);
  assert.match(target.children[0].className, /reader-playback-visual-caption/);
  assert.equal(target.children[0].textContent, '图 1-1 印度 GDP 变化图');
  assert.equal(target.children[1].className, 'reader-playback-asset-slot');
});

test('canonical lifecycle places layout integrity after responsive layout', () => {
  const source = fs.readFileSync(require.resolve('../reader-resume-lifecycle.js'), 'utf8');
  const responsive = source.indexOf('speed-reading-responsive-layout.js');
  const integrity = source.indexOf('speed-reading-layout-integrity.js');
  assert.ok(responsive >= 0 && integrity > responsive);
  assert.match(source, /function versionedAsset\(src, documentObject/u);
  assert.match(source, /script\.src = versionedAsset\(src\)/u);
  assert.match(source, /script\.dataset\.readerEnhancement = src/u);
});