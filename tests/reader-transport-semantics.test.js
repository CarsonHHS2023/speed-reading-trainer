const test = require('node:test');
const assert = require('node:assert/strict');

const Transport = require('../reader-transport-semantics.js');

function node(order) {
  return {
    node_id: `n${order}`,
    node_type: 'paragraph',
    order,
    text: `text ${order}`,
    location: { node_id: `n${order}` },
  };
}

const model = {
  orderedNodes(nodes) {
    return [...nodes].sort((a, b) => a.order - b.order);
  },
  mergeNodes(existing, incoming) {
    const byId = new Map(existing.map((item) => [item.node_id, item]));
    for (const item of incoming) byId.set(item.node_id, item);
    return [...byId.values()].sort((a, b) => a.order - b.order);
  },
  findNodeById(nodes, nodeId) {
    return (nodes || []).find((item) => item.node_id === nodeId) || null;
  },
};

function makeChunk(start, total = 1000) {
  const end = Math.min(total, start + Transport.WINDOW_SIZE);
  return {
    nodes: Array.from({ length: Math.max(0, end - start) }, (_, index) => node(start + index)),
    has_more: end < total,
    next_node_order: end < total ? end : null,
  };
}

function makeReader(total = 1000) {
  const requests = [];
  const status = [];
  const pagesElement = { querySelectorAll() { return []; } };
  const loadMoreButton = { hidden: false };
  const nodeElements = new Map();
  const reader = {
    documentRef: 'doc-1',
    candidateId: 'cand-1',
    openResponse: {
      document_ref: 'doc-1',
      candidate_id: 'cand-1',
      contract_version: '2',
      candidate_schema_id: 'schema',
      candidate_schema_version: 2,
    },
    model,
    nodes: [],
    presentationState: { pages: [] },
    document: {
      querySelector(selector) {
        const match = String(selector).match(/data-reader-node-id="([^"]+)"/);
        return match ? nodeElements.get(match[1]) || null : null;
      },
    },
    api: {
      async content(_documentRef, options) {
        requests.push({ ...options });
        return makeChunk(options.startNodeOrder, total);
      },
    },
    element(id) {
      if (id === 'readerV2Pages') return pagesElement;
      if (id === 'readerV2LoadMore') return loadMoreButton;
      return null;
    },
    reflowAndRender() {
      this.presentationState = {
        pages: this.nodes.map((item) => ({ nodes: [item] })),
      };
      for (const item of this.nodes) {
        nodeElements.set(item.node_id, {
          scrollIntoView() { this.scrolled = true; },
          focus() {},
        });
      }
    },
    locationForNode(nodeId) {
      const found = model.findNodeById(this.nodes, nodeId);
      return found ? found.location : null;
    },
    persistLocation(location, extra) {
      this.persisted = { location, extra };
      return { ...location, node_order: extra?.nodeOrder ?? null };
    },
    setStatus(message) { status.push(message); },
  };
  return { loadMoreButton, reader, requests, status };
}

test('Reader windows are aligned to 150-node boundaries', () => {
  assert.equal(Transport.WINDOW_SIZE, 150);
  assert.equal(Transport.windowStartForOrder(0), 0);
  assert.equal(Transport.windowStartForOrder(149), 0);
  assert.equal(Transport.windowStartForOrder(150), 150);
  assert.equal(Transport.windowStartForOrder(620), 600);
});

test('resume with node_order loads only its 150-node window plus the following window', async () => {
  const { reader, requests } = makeReader(1000);
  reader.resume = { sameCandidate() { return true; } };
  reader.resumeRecord = null;

  const record = {
    node_id: 'n620',
    node_order: 620,
    frame_id: null,
    frame_ordinal: null,
  };
  const restored = await Transport.restoreWindowedResume(reader, record, {});

  assert.equal(restored, true);
  assert.deepEqual(requests.map((item) => [item.startNodeOrder, item.limit]), [
    [600, 150],
    [750, 150],
  ]);
  assert.equal(reader.nodes.length, 300);
  assert.equal(reader.nodes[0].order, 600);
  assert.equal(reader.nodes.at(-1).order, 899);
  assert.equal(reader.lastLocation.node_id, 'n620');
});

test('legacy resume without node_order is probed once and then upgraded with node_order', async () => {
  const { reader, requests } = makeReader(500);
  reader.resume = { sameCandidate() { return true; } };
  const record = {
    node_id: 'n320',
    node_order: null,
    frame_id: 'frame-old',
    frame_ordinal: 2,
  };

  const restored = await Transport.restoreWindowedResume(reader, record, {});
  assert.equal(restored, true);
  assert.deepEqual(requests.slice(0, 3).map((item) => item.startNodeOrder), [0, 150, 300]);
  assert.equal(reader.persisted.extra.nodeOrder, 320);
  assert.equal(reader.persisted.extra.frameId, 'frame-old');
  assert.equal(reader.persisted.extra.frameOrdinal, 2);
  assert.equal(reader.nodes[0].order, 300);
});

function makeReaderControllerClass(resumeRecord = null, total = 1000) {
  return class FakeReaderController {
    constructor() {
      this.model = model;
      this.nodes = [];
      this.navigation = [];
      this.presentationState = { pages: [] };
      this.resume = { sameCandidate() { return true; } };
      this.resumeStore = {
        read() { return resumeRecord; },
        clear() {},
      };
      this.elements = new Map([
        ['readerV2Navigation', { children: [], querySelectorAll() { return this.children; } }],
        ['readerV2Pages', { children: [], querySelectorAll() { return this.children; } }],
        ['readerV2LoadMore', { hidden: false }],
      ]);
      this.document = { querySelector() { return null; } };
      this.requests = [];
      this.api = {
        open: async () => ({
          document_ref: 'doc-1', candidate_id: 'cand-1', contract_version: '2',
          candidate_schema_id: 'schema', candidate_schema_version: 2,
        }),
        navigation: async () => ({ navigation: [] }),
        content: async (_doc, options) => {
          this.requests.push(options.startNodeOrder);
          return makeChunk(options.startNodeOrder, total);
        },
      };
    }
    reset() {
      this.nodes = [];
      this.navigation = [];
      this.presentationState = { pages: [] };
      this.lastLocation = null;
      this.resumeRecord = null;
    }
    activateReaderSurface() {}
    setStatus() {}
    clear() {}
    element(id) { return this.elements.get(id) || null; }
    renderHeader() {}
    renderNavigation() {}
    persistLocation(location, extra = {}) {
      this.persisted = { location, extra };
      this.resumeRecord = { ...location, node_order: extra.nodeOrder ?? null };
      return this.resumeRecord;
    }
    locationForNode(nodeId) {
      return model.findNodeById(this.nodes, nodeId)?.location || null;
    }
    reflowAndRender() {
      this.presentationState = { pages: this.nodes.map((item) => ({ nodes: [item] })) };
    }
    renderError(error) { throw error; }
  };
}

test('first-time open requests only the first 150-node window', async () => {
  const ReaderController = makeReaderControllerClass(null, 1000);
  const root = { ReaderUIV2: { ReaderV2Controller: ReaderController } };
  Transport.installReaderWindowing(root);
  const reader = new ReaderController();
  await reader.openBook({ id: 'doc-1', name: 'Demo' });
  assert.deepEqual(reader.requests, [0]);
  assert.equal(reader.nodes.length, 150);
  assert.equal(reader.nodes[0].order, 0);
  assert.equal(reader.nodes.at(-1).order, 149);
});

test('open with ordered history requests the history window and following window, not the prefix', async () => {
  const resumeRecord = { node_id: 'n620', node_order: 620 };
  const ReaderController = makeReaderControllerClass(resumeRecord, 1000);
  const root = { ReaderUIV2: { ReaderV2Controller: ReaderController } };
  Transport.installReaderWindowing(root);
  const reader = new ReaderController();
  reader.document = {
    querySelector(selector) {
      if (String(selector).includes('n620')) return { scrollIntoView() {}, focus() {} };
      return null;
    },
  };
  await reader.openBook({ id: 'doc-1', name: 'Demo' });
  assert.deepEqual(reader.requests, [600, 750]);
  assert.equal(reader.nodes.length, 300);
  assert.equal(reader.lastLocation.node_id, 'n620');
});

function makePlaybackHarness() {
  class PlaybackController {
    constructor() {
      this.frames = [];
      this.index = 0;
      this.state = 'idle';
    }
    setFrames(frames) { this.frames = [...frames]; this.index = 0; this.state = 'idle'; }
    currentFrame() { return this.frames[this.index] || null; }
    seek(progress, options = {}) {
      this.index = Math.min(this.frames.length - 1, Math.floor(Number(progress) * this.frames.length));
      if (options.activate === false) this.state = 'idle';
      return this.currentFrame();
    }
    play() { this.state = 'playing'; return this.frames.length > 0; }
    snapshot() { return { state: this.state, index: this.index, frame_count: this.frames.length, frame: this.currentFrame() }; }
  }

  class SpeedController {
    constructor(reader) {
      this.reader = reader;
      this.playback = new PlaybackController();
      this.adapter = {
        buildPlaybackFrames(_open, nodes) {
          this.lastBuiltOrders = nodes.map((item) => item.order);
          return {
            frames: nodes.map((item) => ({
              frame_id: `f${item.order}`,
              identity: { node_id: item.node_id },
              source_spans: [{ node_id: item.node_id }],
              kind: 'timed_text',
            })),
          };
        },
      };
      this.trainingClock = { state: 'idle', start() { this.state = 'running'; }, stop() { this.state = 'stopped'; } };
    }
    isReaderActive() { return true; }
    adapterOptions() { return { displayScope: 'line', lineWidth: 35, maxLines: 3, speedPerMinute: 600 }; }
    applyVisualSettings() {}
    beginTrainingSession() { this.trainingClock.start(); }
    stopTrainingTicker() {}
    updateControls() {}
    refreshFrames() { throw new Error('original full Reader refresh must not run'); }
    async start() { throw new Error('original ensure-all start must not run'); }
    stop() { this.playback.state = 'idle'; }
  }

  const first = Array.from({ length: 150 }, (_, index) => node(index));
  const second = Array.from({ length: 150 }, (_, index) => node(150 + index));
  const pagesElement = {
    querySelectorAll() {
      return [{ getBoundingClientRect() { return { top: 0, bottom: 800 }; }, scrollIntoView() {} }];
    },
  };
  const main = { getBoundingClientRect() { return { top: 0, bottom: 800, height: 800 }; } };
  const reader = {
    openResponse: { candidate_id: 'cand-1' },
    nodes: first.concat(second),
    presentationState: { pages: [{ nodes: [node(170), node(171)] }] },
    __readerContentWindows: new Map([
      [0, { start: 0, nodes: first, hasMore: true, nextNodeOrder: 150 }],
      [150, { start: 150, nodes: second, hasMore: true, nextNodeOrder: 300 }],
    ]),
    element(id) { return id === 'readerV2Pages' ? pagesElement : null; },
    document: { querySelector(selector) { return selector === '.reader-v2-main' ? main : null; } },
    setStatus() {},
  };
  const root = {
    ReaderSpeedPlaybackUI: { ReaderSpeedPlaybackUIController: SpeedController },
    ReaderPlaybackController: {
      frameContainsNode(frame, nodeId) { return frame?.identity?.node_id === nodeId; },
    },
  };
  Transport.installPlaybackBatchStart(root);
  return { reader, SpeedController };
}

test('speed reading converts only the current 150-node batch and starts at the ordinary page first node', async () => {
  const { reader, SpeedController } = makePlaybackHarness();
  const controller = new SpeedController(reader);
  const started = await controller.start();

  assert.equal(started, true);
  assert.equal(controller.playback.state, 'playing');
  assert.equal(controller.playback.frames.length, 150);
  assert.equal(controller.adapter.lastBuiltOrders[0], 150);
  assert.equal(controller.adapter.lastBuiltOrders.at(-1), 299);
  assert.equal(controller.playback.currentFrame().identity.node_id, 'n170');
  assert.equal(controller.__readerSpeedBatchStart, 150);
});