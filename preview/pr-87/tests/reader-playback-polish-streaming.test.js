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

function pageFrame(id, lines) {
  return {
    frame_id: id,
    kind: 'timed_text',
    lines,
    identity: lines[0].identity,
    source_spans: lines.flatMap((line) => line.source_spans),
    placement: {
      display_scope: 'page',
      page_height_px: 100,
      row_gap_px: 5,
      virtual_page_index: 0,
    },
  };
}

test('forward window merge repacks the upcoming Page tail across the 150-node boundary', () => {
  const current = [
    pageFrame('current', [row('a', 'n1'), row('b', 'n2'), row('c', 'n3')]),
    pageFrame('old-tail', [row('d', 'n4'), row('e', 'n5')]),
  ];
  const incoming = [
    pageFrame('next-head', [row('f', 'n6'), row('g', 'n7'), row('h', 'n8')]),
  ];
  const controller = {
    adapter: { frameDurationMs: (units) => units * 10 },
    element: (id) => id === 'speedInput' ? { value: '600' } : null,
    displayScope: () => 'page',
    playback: {
      frames: current,
      snapshot: () => ({ index: 0, frame_count: current.length }),
    },
  };

  const merged = Polish.mergePlaybackFrames(controller, incoming, 1);
  assert.deepEqual(merged.map((frame) => frame.lines.length), [3, 3, 2]);
  assert.equal(merged[0].frame_id, 'current');
  assert.equal(merged[1].text, 'd\ne\nf');
});

test('edge prefetch starts early enough to hide ordinary 150-node boundary latency', () => {
  assert.ok(Polish.EDGE_PREFETCH_FRAMES >= 20);
});

test('transport busy state is visible in the speed-reading toolbar and disables navigation', () => {
  const elements = new Map();
  for (const id of ['speedReadingFirst', 'speedReadingPrev', 'speedReadingNext', 'speedReadingLast']) {
    elements.set(id, { disabled: false });
  }
  const state = {
    textContent: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
  };
  elements.set('speedReadingState', state);
  const controller = {
    element: (id) => elements.get(id) || null,
    updateControls() { Polish.applyTransportBusyState(this); },
  };

  Polish.setTransportBusy(controller, '正在定位整本书最后一帧 · 已扫描 450 个节点（3 批）…');
  assert.equal(state.textContent, '正在定位整本书最后一帧 · 已扫描 450 个节点（3 批）…');
  assert.equal(state.attributes['aria-busy'], 'true');
  for (const id of ['speedReadingFirst', 'speedReadingPrev', 'speedReadingNext', 'speedReadingLast']) {
    assert.equal(elements.get(id).disabled, true);
  }

  Polish.clearTransportBusy(controller);
  assert.equal(controller.__playbackTransportBusyMessage, '');
});

test('document-tail scan reports node and batch progress while avoiding intermediate frame conversion', async () => {
  const records = {
    150: { start: 150, nodes: Array.from({ length: 150 }, (_, i) => ({ node_id: `n${150 + i}` })), hasMore: true, nextNodeOrder: 300 },
    300: { start: 300, nodes: Array.from({ length: 150 }, (_, i) => ({ node_id: `n${300 + i}` })), hasMore: true, nextNodeOrder: 450 },
    450: { start: 450, nodes: Array.from({ length: 25 }, (_, i) => ({ node_id: `n${450 + i}` })), hasMore: false, nextNodeOrder: null },
  };
  const cached = new Map([[150, records[150]]]);
  const calls = [];
  const progress = [];
  const controller = {
    activeBatchStart: 150,
    reader: {
      windowRecord: (start) => cached.get(start) || null,
      async requestWindow(start, options = {}) {
        calls.push([start, options.cache]);
        const record = records[start] || null;
        if (record && options.cache !== false) cached.set(start, record);
        return record;
      },
    },
  };
  Polish.playbackWindowStarts(controller).add(150);

  const tail = await Polish.findLastWindow(controller, (value) => progress.push(value));
  assert.equal(tail.start, 450);
  assert.deepEqual(progress.map((value) => [value.scannedNodes, value.scannedWindows]), [
    [150, 1], [300, 2], [325, 3],
  ]);
  assert.deepEqual(calls, [[150, undefined], [300, false], [450, false], [450, undefined]]);
});
