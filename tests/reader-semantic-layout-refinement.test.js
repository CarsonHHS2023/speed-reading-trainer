const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Refinement = require('../reader-semantic-layout-refinement.js');

function mockSlot(height = 0) {
  return {
    style: {},
    dataset: {},
    classList: { remove() {} },
    offsetHeight: height,
    scrollHeight: height,
    firstElementChild: null,
    children: [],
  };
}

function entry(index, type, bbox, options = {}) {
  const rawType = options.rawType || type;
  const nodeId = options.nodeId || `node-${index}`;
  const parentRef = options.parentRef || '';
  return {
    index,
    type,
    rawType,
    bbox,
    nodeId,
    parentRef,
    element: {
      node_id: nodeId,
      normalized_bbox: bbox,
      node: {
        node_id: nodeId,
        node_type: rawType,
        parent_ref: parentRef || null,
      },
    },
    slot: options.slot || mockSlot(options.height || 0),
    textFlow: options.textFlow ?? !['figure', 'table'].includes(type),
    visualCaptions: [],
    visualCaptionParentIndex: null,
  };
}

test('refinement raises the semantic body font from the conservative 16px baseline', () => {
  assert.equal(Refinement.BODY_FONT_PX, 18);
  assert.match(Refinement.STYLE_TEXT, /--reader-semantic-body-font-size:\s*18px/);
});

test('small visual and horizontally adjacent prose can share their source row', () => {
  const stop = entry(0, 'figure', [0.16, 0.42, 0.24, 0.48]);
  const instruction = entry(1, 'paragraph', [0.27, 0.415, 0.84, 0.485]);
  assert.equal(Refinement.isSmallVisualEntry(stop), true);
  assert.ok(Refinement.verticalOverlapRatio(stop.bbox, instruction.bbox) > 0.8);
  assert.equal(Refinement.horizontallyDisjoint(stop.bbox, instruction.bbox), true);
  assert.equal(Refinement.canShareInlineRow(stop, instruction), true);
});

test('small visual and adjacent wide artwork can share a second callout row', () => {
  const person = entry(0, 'figure', [0.17, 0.50, 0.28, 0.59]);
  const banner = entry(1, 'figure', [0.31, 0.505, 0.78, 0.59]);
  assert.equal(Refinement.canShareInlineRow(person, banner), true);
});

test('vertically stacked visuals do not get collapsed into one row', () => {
  const stop = entry(0, 'figure', [0.16, 0.42, 0.24, 0.48]);
  const person = entry(1, 'figure', [0.17, 0.50, 0.28, 0.59]);
  assert.equal(Refinement.canShareInlineRow(stop, person), false);
});

test('two ordinary wide blocks keep normal vertical flow', () => {
  const paragraph = entry(0, 'paragraph', [0.10, 0.30, 0.90, 0.38]);
  const figure = entry(1, 'figure', [0.15, 0.31, 0.82, 0.55]);
  assert.equal(Refinement.isSmallVisualEntry(figure), false);
  assert.equal(Refinement.canShareInlineRow(paragraph, figure), false);
});

test('pairing chooses the overlapping horizontal peer and leaves later rows separate', () => {
  const entries = [
    entry(0, 'figure', [0.16, 0.42, 0.24, 0.48]),
    entry(1, 'paragraph', [0.27, 0.415, 0.84, 0.485]),
    entry(2, 'figure', [0.17, 0.50, 0.28, 0.59]),
    entry(3, 'figure', [0.31, 0.505, 0.78, 0.59]),
  ];
  const pairs = Refinement.pairInlineRows(entries);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs[0].map((item) => item.index), [0, 1]);
  assert.deepEqual(pairs[1].map((item) => item.index), [2, 3]);
});

test('canonical parent_ref attaches caption to visual independently of caption text or source y', () => {
  const figure = entry(0, 'figure', [0.20, 0.30, 0.70, 0.50], {
    nodeId: 'figure-node',
    textFlow: false,
  });
  const body = entry(1, 'paragraph', [0.10, 0.60, 0.90, 0.68], { height: 70 });
  const caption = entry(2, 'caption', [0.37, 0.90, 0.42, 0.92], {
    nodeId: 'caption-node',
    parentRef: 'figure-node',
    height: 20,
  });

  const entries = [figure, body, caption];
  assert.equal(Refinement.attachCanonicalVisualCaptions(entries), 1);
  assert.equal(caption.visualCaptionParentIndex, figure.index);
  assert.deepEqual(figure.visualCaptions, [caption]);
  assert.equal(Refinement.pairInlineRows(entries).some((pair) => pair.includes(caption)), false);
});

test('caption is part of the visual flow unit instead of remaining at its late source position', () => {
  const figure = entry(0, 'figure', [0.20, 0.30, 0.70, 0.50], {
    nodeId: 'figure-node',
    textFlow: false,
  });
  const body = entry(1, 'paragraph', [0.10, 0.60, 0.90, 0.68], { height: 70 });
  const caption = entry(2, 'caption', [0.37, 0.90, 0.42, 0.92], {
    nodeId: 'caption-node',
    parentRef: 'figure-node',
    height: 20,
  });
  const entries = [figure, body, caption];
  Refinement.attachCanonicalVisualCaptions(entries);

  const units = Refinement.buildFlowUnits(entries, Refinement.pairInlineRows(entries), 1000);
  assert.equal(units.length, 2, 'caption is removed from independent top-level flow');
  assert.equal(units[0].type, 'figure');
  assert.equal(units[1].type, 'paragraph');
  assert.equal(units[0].memberLayout[0].captionLayouts.length, 1);
  assert.equal(units[0].memberLayout[0].captionLayouts[0].offset, 206);
  assert.equal(units[0].height, 226, 'figure height includes 6px gap plus caption height');
});

test('flow application places canonical caption immediately below its parent visual', () => {
  const figure = entry(0, 'figure', [0.20, 0.30, 0.70, 0.50], {
    nodeId: 'figure-node',
    textFlow: false,
  });
  figure.slot.style.left = '20%';
  figure.slot.style.width = '50%';
  const body = entry(1, 'paragraph', [0.10, 0.60, 0.90, 0.68], { height: 70 });
  const caption = entry(2, 'caption', [0.37, 0.90, 0.42, 0.92], {
    nodeId: 'caption-node',
    parentRef: 'figure-node',
    height: 20,
  });
  const entries = [figure, body, caption];
  Refinement.attachCanonicalVisualCaptions(entries);
  const units = Refinement.buildFlowUnits(entries, [], 1000);
  Refinement.applyFlowUnits(units, 1000, {
    compactSourceGap() { return 20; },
  });

  assert.equal(figure.slot.style.top, '140px');
  assert.equal(caption.slot.style.top, '346px');
  assert.equal(caption.slot.style.left, '20%');
  assert.equal(caption.slot.style.width, '50%');
  assert.equal(caption.slot.dataset.readerVisualCaptionParent, 'figure-node');
  assert.equal(body.slot.style.top, '386px', 'following body starts after the combined figure-caption unit');
});

test('unrelated caption is not attached when parent_ref does not resolve to a visual', () => {
  const figure = entry(0, 'figure', [0.20, 0.30, 0.70, 0.50], { nodeId: 'figure-node' });
  const caption = entry(1, 'caption', [0.30, 0.55, 0.50, 0.58], {
    parentRef: 'missing-node',
    height: 20,
  });
  assert.equal(Refinement.attachCanonicalVisualCaptions([figure, caption]), 0);
  assert.equal(caption.visualCaptionParentIndex, null);
});

test('main page loads the refinement after presentation bootstrap begins', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const presentation = html.indexOf('reader-presentation.js');
  const refinement = html.indexOf('reader-semantic-layout-refinement.js');
  assert.ok(presentation >= 0);
  assert.ok(refinement > presentation);
});
