const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Policy = require('../reader-resume-window-policy.js');

function makeNodes(start) {
  return Array.from({ length: 150 }, (_, i) => ({
    node_id: `n${start + i}`,
    order: start + i,
    location: { node_id: `n${start + i}` },
  }));
}

function fixture() {
  class Controller {}
  const ReaderUI = {
    NODE_LIMIT: 150,
    ReaderV2Controller: Controller,
    windowStartForOrder(order) { return Math.floor(order / 150) * 150; },
  };
  Policy.install({ ReaderUIV2: ReaderUI });
  const c = new Controller();
  c.documentRef = 'doc';
  c.candidateId = 'candidate';
  c.openResponse = { candidate_id: 'candidate' };
  c.contentWindows = new Map();
  c.nodes = [];
  c.clearedResumeRefs = [];
  c.resume = { sameCandidate() { return true; } };
  c.resumeStore = { clear(ref) { c.clearedResumeRefs.push(ref); } };
  c.model = {
    orderedNodes(value) { return [...value]; },
    findNodeById(value, id) { return value.find((node) => node.node_id === id) || null; },
  };
  c.setStatus = () => {};
  c.setVisibleWindows = (starts) => {
    c.visibleStarts = [...starts];
    c.nodes = starts.flatMap((start) => c.contentWindows.get(start)?.nodes || []);
  };
  c.locationForNode = (id) => ({ node_id: id });
  c.scrollLoadedNode = () => true;
  c.persistLocation = (_location, extra) => {
    c.persistedNodeOrder = extra.nodeOrder;
    return null;
  };
  return c;
}

test('legacy history uses one server lookup and activates only its containing 150-node window', async () => {
  const c = fixture();
  let calls = 0;
  c.api = {
    async contentAround(_doc, nodeId, options) {
      calls += 1;
      assert.equal(nodeId, 'n217');
      assert.equal(options.limit, 150);
      return { nodes: makeNodes(150), has_more: true, next_node_order: 300 };
    },
  };
  c.requestWindow = async () => assert.fail('legacy history must not scan content windows');

  await c.restoreResumeLocation({ node_id: 'n217', node_order: null });

  assert.equal(calls, 1);
  assert.deepEqual(c.visibleStarts, [150]);
  assert.equal(c.nodes.length, 150);
  assert.equal(c.persistedNodeOrder, 217);
  assert.deepEqual(c.clearedResumeRefs, []);
});

test('missing legacy resume node is cleared and returns null so openBook can load the first valid window', async () => {
  const c = fixture();
  c.resumeRecord = { node_id: 'stale-node' };
  c.api = {
    async contentAround() {
      const error = new Error('The Reader node does not exist in the selected content.');
      error.status = 404;
      error.code = 'reader_node_not_found';
      throw error;
    },
  };
  c.requestWindow = async () => assert.fail('stale legacy lookup must return control to openBook fallback');

  const restored = await c.restoreResumeLocation({ node_id: 'stale-node', node_order: null });

  assert.equal(restored, null);
  assert.equal(c.resumeRecord, null);
  assert.deepEqual(c.clearedResumeRefs, ['doc']);
});

test('legacy lookup response that no longer contains the saved node is also treated as stale local history', async () => {
  const c = fixture();
  c.api = {
    async contentAround() {
      return { nodes: makeNodes(150), has_more: true, next_node_order: 300 };
    },
  };

  const restored = await c.restoreResumeLocation({ node_id: 'missing-node', node_order: null });

  assert.equal(restored, null);
  assert.deepEqual(c.clearedResumeRefs, ['doc']);
});

test('non-404 legacy lookup failures still propagate instead of hiding a real Reader service error', async () => {
  const c = fixture();
  const serviceError = new Error('service unavailable');
  serviceError.status = 503;
  serviceError.code = 'reader_service_unavailable';
  c.api = { async contentAround() { throw serviceError; } };

  await assert.rejects(
    c.restoreResumeLocation({ node_id: 'n217', node_order: null }),
    (error) => error === serviceError,
  );
  assert.deepEqual(c.clearedResumeRefs, []);
});

test('modern history requests only its aligned 150-node window', async () => {
  const c = fixture();
  const requested = [];
  c.api = { contentAround: async () => assert.fail('modern history does not need lookup') };
  c.requestWindow = async (start) => {
    requested.push(start);
    const record = { start, nodes: makeNodes(start), hasMore: true, nextNodeOrder: start + 150 };
    c.contentWindows.set(start, record);
    return record;
  };

  await c.restoreResumeLocation({ node_id: 'n217', node_order: 217 });

  assert.deepEqual(requested, [150]);
  assert.deepEqual(c.visibleStarts, [150]);
  assert.equal(c.nodes.length, 150);
  assert.deepEqual(c.clearedResumeRefs, []);
});

test('modern history clears a saved node that no longer exists in its aligned window', async () => {
  const c = fixture();
  c.requestWindow = async (start) => {
    const nodes = makeNodes(start).filter((node) => node.node_id !== 'n217');
    const record = { start, nodes, hasMore: true, nextNodeOrder: start + 150 };
    c.contentWindows.set(start, record);
    return record;
  };

  const restored = await c.restoreResumeLocation({ node_id: 'n217', node_order: 217 });

  assert.equal(restored, null);
  assert.deepEqual(c.clearedResumeRefs, ['doc']);
});

test('canonical lifecycle installs bounded resume before playback enhancements', () => {
  const source = fs.readFileSync(require.resolve('../reader-resume-lifecycle.js'), 'utf8');
  assert.ok(source.indexOf('reader-resume-window-policy.js') >= 0);
  assert.ok(source.indexOf('speed-reading-structure-policy.js') > source.indexOf('reader-resume-window-policy.js'));
});
