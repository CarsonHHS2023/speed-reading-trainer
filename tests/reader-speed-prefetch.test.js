const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Prefetch = require('../reader-speed-prefetch.js');

function makeController(options = {}) {
  const requests = [];
  const statuses = [];
  const builtWith = [];
  const setFrameCalls = [];
  const workerUrls = [];
  const workerInstances = [];
  const readerNodes = Array.from({ length: options.readerNodeCount || 2 }, (_, index) => ({
    node_id: `n${index}`,
  }));
  const chunks = options.chunks || new Map([
    [2, { nodes: [{ node_id: 'n2' }, { node_id: 'n3' }], has_more: true, next_node_order: 4 }],
    [4, { nodes: [{ node_id: 'n4' }], has_more: false, next_node_order: null }],
  ]);
  const reader = {
    documentRef: 'doc-1',
    candidateId: 'cand-1',
    openResponse: {
      contract_version: '2',
      document_ref: 'doc-1',
      candidate_id: 'cand-1',
      candidate_schema_id: 'structured-content-v2',
      candidate_schema_version: 2,
      source_units: [],
    },
    nodes: readerNodes,
    hasMore: options.hasMore ?? true,
    nextNodeOrder: options.nextNodeOrder ?? readerNodes.length,
    lastLocation: options.lastLocation || null,
    setStatus(message) { statuses.push(message); },
    model: {
      mergeNodes(existing, incoming) {
        const byId = new Map(existing.map((node) => [node.node_id, node]));
        for (const node of incoming) byId.set(node.node_id, node);
        return Array.from(byId.values());
      },
    },
    api: {
      async content(documentRef, requestOptions) {
        requests.push({ documentRef, ...requestOptions });
        const chunk = chunks.get(requestOptions.startNodeOrder);
        if (!chunk) throw new Error(`unexpected chunk start ${requestOptions.startNodeOrder}`);
        return chunk;
      },
    },
  };

  const playback = {
    frames: [{ frame_id: 'existing-n1', identity: { node_id: 'n1' }, kind: 'timed_text', duration_ms: 1000 }],
    index: 0,
    state: options.playbackState || 'idle',
    remainingMs: options.remainingMs ?? null,
    currentFrame() { return this.frames[this.index] || null; },
    snapshot() {
      return {
        state: this.state,
        index: this.index,
        frame: this.currentFrame(),
        frame_count: this.frames.length,
        remaining_ms: this.remainingMs,
      };
    },
    setFrames(frames, frameOptions = {}) {
      const previousNode = this.currentFrame()?.identity?.node_id || null;
      setFrameCalls.push({ frames, options: frameOptions, previousNode });
      this.frames = Array.isArray(frames) ? [...frames] : [];
      const matching = previousNode
        ? this.frames.findIndex((frame) => frame?.identity?.node_id === previousNode)
        : -1;
      this.index = matching >= 0 ? matching : 0;
    },
    cancelTimer() {},
    scheduleCurrent() {},
  };

  const controller = {
    reader,
    playback,
    adapterOptions() {
      return {
        displayScope: 'line',
        lineWidth: 35,
        maxLines: 3,
        speedPerMinute: 5000,
      };
    },
    adapter: {
      buildPlaybackFrames(_open, nodes) {
        builtWith.push(nodes.map((node) => node.node_id));
        return {
          frames: nodes.map((node) => ({
            frame_id: `frame-${node.node_id}`,
            identity: { node_id: node.node_id },
            kind: 'timed_text',
            duration_ms: 1000,
          })),
        };
      },
    },
    updateControls() {},
  };

  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.terminated = false;
      workerUrls.push(url);
      workerInstances.push(this);
    }

    postMessage(payload) {
      this.payload = payload;
      if (options.deferWorker) return;
      queueMicrotask(() => this.resolve());
    }

    resolve(frames) {
      const builtFrames = frames || (this.payload?.nodes || []).map((node) => ({
        frame_id: `worker-${node.node_id}`,
        identity: { node_id: node.node_id },
        kind: 'timed_text',
        duration_ms: 1000,
      }));
      this.onmessage?.({
        data: {
          id: this.payload.id,
          ok: true,
          frames: builtFrames,
        },
      });
    }

    terminate() { this.terminated = true; }
  }

  const rootObject = {
    ReaderApiV2: { MAX_NODE_LIMIT: 500 },
    ReaderResumeLifecycleV2: {
      versionedAsset(src) { return `${src}?v=test-head`; },
    },
    Worker: FakeWorker,
    requestAnimationFrame(callback) { callback(); },
    console: { warn() {} },
  };
  return {
    builtWith,
    controller,
    readerNodes,
    requests,
    rootObject,
    setFrameCalls,
    statuses,
    workerInstances,
    workerUrls,
  };
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
  assert.equal(Prefetch.cachedPlaybackNodes(harness.controller).length, 5);
});

test('speed start returns a bounded seed before the full worker compilation completes', async () => {
  const harness = makeController({ deferWorker: true });
  const target = {
    ensureAllContent: async function originalEnsure() { throw new Error('ordinary loadMore path must not run'); },
    refreshFrames: function originalRefresh() { throw new Error('ordinary full Reader path must not run'); },
  };
  Prefetch.wrapEnsureAllContent(target, harness.rootObject);
  Prefetch.wrapRefreshFrames(target, harness.rootObject);
  Object.setPrototypeOf(harness.controller, target);

  const seed = await harness.controller.ensureAllContent();
  assert.deepEqual(seed.map((node) => node.node_id), ['n0', 'n1']);

  const seedFrames = harness.controller.refreshFrames();
  assert.equal(seedFrames.length, 2);
  assert.deepEqual(harness.builtWith.at(-1), ['n0', 'n1']);
  assert.equal(harness.setFrameCalls.length, 1);

  for (let attempt = 0; attempt < 10 && harness.workerInstances.length === 0; attempt += 1) {
    await Promise.resolve();
  }
  assert.equal(harness.workerInstances.length, 1);
  assert.equal(harness.workerUrls[0], 'reader-speed-frame-worker.js?v=test-head');
  assert.deepEqual(harness.workerInstances[0].payload.nodes.map((node) => node.node_id), ['n0', 'n1', 'n2', 'n3', 'n4']);

  harness.workerInstances[0].resolve();
  await harness.controller.__readerSpeedBackgroundPromise;

  assert.equal(harness.setFrameCalls.length, 2);
  assert.equal(harness.setFrameCalls[1].options.preserveIdentity, true);
  assert.equal(harness.setFrameCalls[1].frames.length, 5);
  assert.equal(harness.controller.reader.nodes, harness.readerNodes);
  assert.equal(harness.controller.reader.nodes.length, 2);
});

test('completed worker frames are reused on later speed starts without another fetch or build', async () => {
  const harness = makeController();
  const target = {
    ensureAllContent: async function originalEnsure() { throw new Error('ordinary loadMore path must not run'); },
    refreshFrames: function originalRefresh() { throw new Error('ordinary Reader path must not run'); },
  };
  Prefetch.wrapEnsureAllContent(target, harness.rootObject);
  Prefetch.wrapRefreshFrames(target, harness.rootObject);
  Object.setPrototypeOf(harness.controller, target);

  await harness.controller.ensureAllContent();
  harness.controller.refreshFrames();
  await harness.controller.__readerSpeedBackgroundPromise;

  const requestCount = harness.requests.length;
  const buildCount = harness.builtWith.length;
  const workerCount = harness.workerInstances.length;
  const nodes = await harness.controller.ensureAllContent();
  const frames = harness.controller.refreshFrames();

  assert.equal(nodes.length, 5);
  assert.equal(frames.length, 5);
  assert.equal(harness.requests.length, requestCount);
  assert.equal(harness.builtWith.length, buildCount);
  assert.equal(harness.workerInstances.length, workerCount);
});

test('large loaded Reader state seeds around the current semantic node instead of compiling all loaded nodes on start', () => {
  const harness = makeController({
    readerNodeCount: 500,
    hasMore: false,
    lastLocation: { node_id: 'n420' },
  });
  harness.controller.playback.frames = [];
  const seed = Prefetch.seedPlaybackNodes(harness.controller);

  assert.equal(seed.length, Prefetch.START_SEED_NODE_LIMIT);
  assert.equal(seed.some((node) => node.node_id === 'n420'), true);
  assert.equal(seed.length < harness.controller.reader.nodes.length, true);
});

test('speed frame worker script parses as standalone JavaScript', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'reader-speed-frame-worker.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(source));
});
