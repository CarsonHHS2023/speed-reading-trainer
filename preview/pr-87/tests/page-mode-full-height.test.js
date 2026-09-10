const test = require('node:test');
const assert = require('node:assert/strict');

const Polish = require('../reader-playback-polish.js');

function row(text, nodeId) {
  return {
    text,
    node_type: 'paragraph',
    row_height_px: 30,
    paragraph_gap_before_px: 0,
    reading_units: 1,
    identity: { candidate_id: 'c', node_id: nodeId },
    source_spans: [{ candidate_id: 'c', node_id: nodeId }],
  };
}

function frame(id, lines, pageHeight = 220) {
  return {
    frame_id: id,
    kind: 'timed_text',
    lines,
    identity: lines[0].identity,
    source_spans: lines.flatMap((line) => line.source_spans),
    placement: {
      display_scope: 'page',
      page_height_px: pageHeight,
      row_gap_px: 5,
      virtual_page_index: 0,
    },
  };
}

test('Page repacking fills measured page height instead of using line-mode linesInput', () => {
  const controller = {
    adapter: { frameDurationMs: (units) => units * 10 },
    element(id) {
      if (id === 'speedInput') return { value: '600' };
      if (id === 'linesInput') return { value: '3' };
      return null;
    },
  };

  const rows = Array.from({ length: 6 }, (_, index) => row(String(index + 1), `n${index + 1}`));
  const packed = Polish.repackPageFrames(controller, [
    frame('f1', rows.slice(0, 3)),
    frame('f2', rows.slice(3)),
  ]);

  assert.equal(packed.length, 1);
  assert.equal(packed[0].lines.length, 6);
  assert.equal(packed[0].text, '1\n2\n3\n4\n5\n6');
});

test('Page repacking still obeys the measured height budget', () => {
  const controller = {
    adapter: { frameDurationMs: (units) => units * 10 },
    element: (id) => id === 'speedInput' ? { value: '600' } : null,
  };
  const rows = Array.from({ length: 6 }, (_, index) => row(String(index + 1), `n${index + 1}`));
  const packed = Polish.repackPageFrames(controller, [frame('f1', rows, 100)]);
  assert.deepEqual(packed.map((item) => item.lines.length), [3, 3]);
});
