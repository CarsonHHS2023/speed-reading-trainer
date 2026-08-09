const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Integrity = require('../speed-reading-layout-integrity.js');

test('line mode keeps complete configured groups across virtual-page boundaries and only leaves true tail remainders', () => {
  assert.equal(Integrity.lineFrameCapacity(7, 3), 6);
  assert.equal(Integrity.lineFrameCapacity(8, 3), 6);
  assert.equal(Integrity.lineFrameCapacity(9, 3), 9);
  assert.equal(Integrity.lineFrameCapacity(2, 3), 2);
  assert.equal(Integrity.lineFrameCapacity(7, 1), 7);
});

test('visual captions associate only by canonical parent_ref and never by text or proximity', () => {
  const adapter = {
    resolvedTypeForNode(node) { return { type: node.node_type }; },
  };
  const nodes = [
    { node_id: 'figure-1', node_type: 'figure', order: 2 },
    { node_id: 'caption-1', node_type: 'caption', parent_ref: 'figure-1', text: '图1 正确标题', order: 1 },
    { node_id: 'caption-nearby', node_type: 'caption', text: '图1 看起来很近但没有关系', order: 3 },
    { node_id: 'caption-wrong-parent', node_type: 'caption', parent_ref: 'paragraph-1', text: '错误父节点', order: 4 },
    { node_id: 'paragraph-1', node_type: 'paragraph', text: '正文', order: 5 },
  ];

  const result = Integrity.canonicalCaptionAssociations(adapter, nodes);
  assert.deepEqual([...result.consumedCaptionIds], ['caption-1']);
  assert.deepEqual(result.byParent.get('figure-1').map((item) => item.text), ['图1 正确标题']);
  assert.equal(result.byParent.has('paragraph-1'), false);
});

test('associated caption is removed from timed text layout and attached to the manual visual frame', () => {
  const adapter = {
    resolvedTypeForNode(node) { return { type: node.node_type }; },
    buildReadingElements() {
      return [
        { kind: 'text', node_type: 'caption', text: '表1 复利的作用', identity: { node_id: 'caption-1' } },
        { kind: 'manual', node_type: 'table', text: '', identity: { node_id: 'table-1' }, asset_refs: ['asset-table'] },
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
            kind: 'manual', node_type: 'table', identity: { node_id: 'table-1' }, placement: { display_scope: 'manual', x_px: 0 },
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
  const root = { SpeedReadingAdapter: adapter, SpeedReadingResponsiveLayout: responsive };
  const controller = {
    document: { defaultView: { getComputedStyle() { return { lineHeight: '20px', fontSize: '20px' }; } } },
    reader: {
      openResponse: { candidate_id: 'cand' },
      nodes: [
        { node_id: 'caption-1', node_type: 'caption', parent_ref: 'table-1', text: '表1 复利的作用', order: 1 },
        { node_id: 'table-1', node_type: 'table', order: 2 },
        { node_id: 'p-1', node_type: 'paragraph', text: '后续正文', order: 3 },
      ],
    },
    updateSettingsVisibility() {},
    applyVisualSettings() {},
    adapterOptions() { return { displayScope: 'line', lineCount: 3, maxLines: 3, maxWidthPx: 300, speedPerMinute: 600 }; },
    displayScope() { return 'line'; },
    playbackAvailableHeight() { return 500; },
    element(id) { return id === 'fontInput' ? { value: '20' } : { clientWidth: 348, clientHeight: 500 }; },
  };

  const built = Integrity.buildIntegrityPlaybackFrames(controller, root);
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

test('manual visual caption renderer keeps caption and visual in the same target frame', () => {
  const created = [];
  const documentObject = {
    createElement() {
      const node = { className: '', textContent: '', dataset: {}, style: {} };
      created.push(node);
      return node;
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
    captions: [{ node_id: 'caption-1', text: '图2 富人的现金流' }],
  }, target);

  assert.equal(rendered, true);
  assert.match(target.children[0].className, /reader-playback-visual-caption/);
  assert.equal(target.children[0].textContent, '图2 富人的现金流');
  assert.equal(target.children[1].className, 'reader-playback-asset-slot');
});

test('training clock exact-head loader includes the layout integrity module after responsive layout', () => {
  const source = fs.readFileSync('training-session-clock.js', 'utf8');
  const responsive = source.indexOf('speed-reading-responsive-layout.js');
  const integrity = source.indexOf('speed-reading-layout-integrity.js');
  assert.ok(responsive >= 0 && integrity > responsive);
  assert.match(source, /speed-reading-layout-integrity\.js\?v=\$\{encodeURIComponent\(previewHead\)\}/u);
});
