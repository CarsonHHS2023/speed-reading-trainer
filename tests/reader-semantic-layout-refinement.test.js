const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Refinement = require('../reader-semantic-layout-refinement.js');

function entry(index, type, bbox) {
  return { index, type, bbox };
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

test('main page loads the refinement after presentation bootstrap begins', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const presentation = html.indexOf('reader-presentation.js');
  const refinement = html.indexOf('reader-semantic-layout-refinement.js');
  assert.ok(presentation >= 0);
  assert.ok(refinement > presentation);
});
