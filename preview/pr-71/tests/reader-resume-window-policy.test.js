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
  c.resume = { sameCandidate() { return true; } };
  c.resumeStore = { clear() {} };
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
});

test('canonical lifecycle installs bounded resume before playback enhancements', () => {
  const source = fs.readFileSync(require.resolve('../reader-resume-lifecycle.js'), 'utf8');
  assert.ok(source.indexOf('reader-resume-window-policy.js') >= 0);
  assert.ok(source.indexOf('speed-reading-structure-policy.js') > source.indexOf('reader-resume-window-policy.js'));
});
