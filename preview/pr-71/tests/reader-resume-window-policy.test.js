const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Policy = require('../reader-resume-window-policy.js');

function nodes(start, count = 150) {
  return Array.from({ length: count }, (_, index) => ({
    node_id: `n${start + index}`,
    order: start + index,
    location: { node_id: `n${start + index}` },
  }));
}

function controllerFixture() {
  class Controller {}
  const ReaderUI = {
    NODE_LIMIT: 150,
    ReaderV2Controller: Controller,
    windowStartForOrder(order) { return Math.floor(Number(order) / 150) * 150; },
  };
  assert.equal(Policy.install({ ReaderUIV2: ReaderUI }), true);

  const controller = new Controller();
  controller.documentRef = 'doc';
  controller.candidateId = 'candidate';
  controller.openResponse = { candidate_id: 'candidate' };
  controller.contentWindows = new Map();
  controller.nodes = [];
  controller.statuses = [];
  controller.resume = {
    sameCandidate() { return true; },
  };
  controller.resumeStore = {
    clear() {},
  };
  controller.model = {
    orderedNodes(value) { return [...value].sort((a, b) => a.order - b.order); },
    findNodeById(value, nodeId) { return value.find((node) => node.node_id === nodeId) || null; },
  };
  controller.setStatus = (message) => controller.statuses.push(message);
  controller.setVisibleWindows = (starts) => {
    controller.visibleStarts = [...starts];
    controller.nodes = starts.flatMap((start) => controller.contentWindows.get(start)?.nodes || []);
  };
  controller.locationForNode = (nodeId) => ({ node_id: nodeId });
  controller.scrollLoadedNode = () => true;
  controller.persistLocation = (location, extra) => {
    controller.persisted = { location, extra };
    return { node_id: location.node_id, node_order: extra.nodeOrder };
  };
  return controller;
}

test('legacy resume resolves node id once and activates only its containing 150-node window', async () => {
  const controller = controllerFixture();
  let aroundCalls = 0;
  controller.api = {
    async contentAround(documentRef, nodeId, options) {
      aroundCalls += 1;
      assert.equal(documentRef, 'doc');
      assert.equal(nodeId, 'n217');
      assert.equal(options.limit, 150);
      assert.equal(options.candidateId, 'candidate');
      return { nodes: nodes(150), has_more: true, next_node_order: 300 };
    },
  };
  controller.requestWindow = async () => {
    throw new Error('legacy resume must not scan sequential content windows');
  };

  const result = await controller.restoreResumeLocation({
    node_id: 'n217',
    node_order: null,
    frame_id: null,
    frame_ordinal: null,
  });

  assert.equal(aroundCalls, 1);
  assert.deepEqual(controller.visibleStarts, [150]);
  assert.equal(controller.nodes.length, 150);
  assert.equal(controller.persisted.extra.nodeOrder, 217);
  assert.equal(result.node_order, 217);
  assert.ok(!controller.statuses.some((message) => message.includes('已扫描')));
});

test('modern resume requests only the aligned containing window and not the following batch', async () => {
  const controller = controllerFixture();
  const requested = [];
  controller.api = {
    async contentAround() { throw new Error('modern resume must not need node-id lookup'); },
  };
  controller.requestWindow = async (start) => {
    requested.push(start);
    const record = Object.freeze({ start, nodes: nodes(start), hasMore: true, nextNodeOrder: start + 150 });
    controller.contentWindows.set(start, record);
    return record;
  };

  await controller.restoreResumeLocation({
    node_id: 'n217',
    node_order: 217,
    frame_id: null,
    frame_ordinal: null,
  });

  assert.deepEqual(requested, [150]);
  assert.deepEqual(controller.visibleStarts, [150]);
  assert.equal(controller.nodes.length, 150);
});

test('canonical lifecycle loads bounded resume policy before playback enhancements', () => {
  const source = fs.readFileSync(require.resolve('../reader-resume-lifecycle.js'), 'utf8');
  const resumeIndex = source.indexOf("reader-resume-window-policy.js");
  const playbackIndex = source.indexOf("speed-reading-structure-policy.js");
  assert.ok(resumeIndex >= 0);
  assert.ok(playbackIndex > resumeIndex);
});
