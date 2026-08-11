const test = require('node:test');
const assert = require('node:assert/strict');

const Prefetch = require('../reader-speed-prefetch.js');

function makeController() {
  const requests = [];
  const statuses = [];
  const readerNodes = [
    { node_id: 'n0' },
    { node_id: 'n1' },
  ];
  const chunks = new Map([
    [2, { nodes: [{ node_id: 'n2' }, { node_id: 'n3' }], has_more: true, next_node_order: 4 }],
    [4, { nodes: [{ node_id: 'n4' }], has_more: false, next_node_order: null }],
  ]);
  const reader = {
    documentRef: 'doc-1',
    candidateId: 'cand-1',
    openResponse: { candidate_id: 'cand-1' },
    nodes: readerNodes,
    hasMore: true,
    nextNodeOrder: 2,
    setStatus(message) { statuses.push(message); },
    model: {
      mergeNodes(existing, incoming) {
        const byId = new Map(existing.map((node) => [node.node_id, node]));
        for (const node of incoming) byId.set(node.node_id, node);
        return Array.from(byId.values());
      },
    },
    api: {
      async content(documentRef, options) {
        requests.push({ documentRef, ...options });
        return chunks.get(options.startNodeOrder);
      },
    },
  };
  const builtWith = [];
  const controller = {
    reader,
    adapterOptions() { return { displayScope: 'line' }; },
    adapter: {
      buildPlaybackFrames(_open, nodes) {
        builtWith.push(nodes.map((node) => node.node_id));
        return { frames: nodes.map((node) => ({ frame_id: node.node_id })) };
      },
    },
    playback: {
      setFrames(frames) { this.frames = frames; },
    },
    updateControls() {},
  };
  const rootObject = {
    ReaderApiV2: { MAX_NODE_LIMIT: 500 },
    requestAnimationFrame(callback) { callback(); },
  };
  return { builtWith, controller, readerNodes, requests, rootObject, statuses };
}

test('speed-reading prefetch uses max Reader API chunks without mutating ordinary Reader pagination state', async () => {
  const harness = makeController();
  const nodes = await Prefetch.prefetchPlaybackNodes(harness.controller, harness.rootObject);

  assert.deepEqual(nodes.map((node) => node.node_id), ['n0', 'n1', 'n2', 'n3', 'n4']);
  assert.deepEqual(harness.requests.map((request) => request.limit), [500, 500]);
  assert.deepEqual(harness.requests.map((request) => request.startNodeOrder), [2, 4]);

  assert.equal(harness.controller.reader.nodes, harness.readerNodes);
  assert.deepEqual(harness.controller.reader.nodes.map((node) => node.node_id), ['n0', 'n1']);
  assert.equal(harness.controller.reader.hasMore, true);
  assert.equal(harness.controller.reader.nextNodeOrder, 2);
  assert.equal(harness.statuses.some((message) => message.includes('已加载 5 个内容块')), true);
});

test('refreshFrames uses the complete playback-only cache and reuses it on later starts', async () => {
  const harness = makeController();
  await Prefetch.prefetchPlaybackNodes(harness.controller, harness.rootObject);

  const target = {
    ensureAllContent: async function originalEnsure() { throw new Error('ordinary loadMore path must not run'); },
    refreshFrames: function originalRefresh() { throw new Error('ordinary Reader nodes must not build playback frames'); },
  };
  Prefetch.wrapEnsureAllContent(target, harness.rootObject);
  Prefetch.wrapRefreshFrames(target);
  Object.setPrototypeOf(harness.controller, target);

  const before = harness.requests.length;
  const nodes = await harness.controller.ensureAllContent();
  assert.equal(harness.requests.length, before);
  assert.equal(nodes.length, 5);

  const frames = harness.controller.refreshFrames();
  assert.equal(frames.length, 5);
  assert.deepEqual(harness.builtWith.at(-1), ['n0', 'n1', 'n2', 'n3', 'n4']);
  assert.equal(harness.controller.reader.nodes.length, 2);
});
