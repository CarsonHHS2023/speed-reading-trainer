const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'preview-runtime.js'), 'utf8');

function makeButton(label) {
  const listeners = [];
  const attributes = new Map();
  return {
    dataset: {},
    textContent: label,
    disabled: false,
    addEventListener(type, handler, options = {}) {
      listeners.push({ type, handler, capture: Boolean(options && options.capture) });
    },
    click() {
      const event = { target: this, currentTarget: this };
      for (const listener of listeners.filter((item) => item.type === 'click' && item.capture)) {
        listener.handler(event);
      }
      for (const listener of listeners.filter((item) => item.type === 'click' && !item.capture)) {
        listener.handler(event);
      }
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name); },
  };
}

function installRuntime({ documentObject, readerUI }) {
  const windowObject = {
    location: {
      pathname: '/speed-reading-trainer/preview/pr-70/',
      href: 'https://carsonhhs2023.github.io/speed-reading-trainer/preview/pr-70/',
    },
    fetch: async () => ({ ok: true }),
    Request: global.Request,
    document: documentObject,
    ReaderUIV2: readerUI,
    requestAnimationFrame(callback) { callback(); },
    console: { info() {} },
  };
  const context = vm.createContext({
    window: windowObject,
    URL,
    Request: global.Request,
    console: windowObject.console,
  });
  vm.runInContext(runtimeSource, context, { filename: 'preview-runtime.js' });
  return windowObject;
}

test('first explicit TOC click wins over an in-flight saved-location restore', async () => {
  const chapter37Button = makeButton('第37章');
  const chapter44Button = makeButton('第44章');
  const buttons = [chapter37Button, chapter44Button];
  const nav = {
    querySelectorAll(selector) {
      return selector === '.reader-v2-nav-item' ? buttons : [];
    },
  };
  const main = {
    dataset: {},
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 0,
    addEventListener() {},
  };
  const chapter37Target = {
    scrollCount: 0,
    scrollIntoView() { this.scrollCount += 1; },
    focus() {},
  };
  const chapter44Target = {
    scrollCount: 0,
    scrollIntoView() { this.scrollCount += 1; },
    focus() {},
  };

  let releaseResumeLoad = null;
  let chapter44Loaded = false;
  const statuses = [];

  const documentObject = {
    readyState: 'complete',
    activeElement: null,
    querySelector(selector) {
      if (selector === '.reader-v2-main') return main;
      if (selector.includes('chapter-37')) return chapter37Target;
      if (selector.includes('chapter-44') && chapter44Loaded) return chapter44Target;
      return null;
    },
  };

  class FakeReaderController {
    constructor() {
      this.document = documentObject;
      this.documentRef = 'doc-1';
      this.openResponse = { candidate_id: 'candidate-1' };
      this.candidateId = 'candidate-1';
      this.navigation = [
        { label: '第37章', location: { node_id: 'chapter-37' } },
        { label: '第44章', location: { node_id: 'chapter-44' } },
      ];
      this.nodes = [{ node_id: 'chapter-37', location: { node_id: 'chapter-37' } }];
      this.hasMore = true;
      this.presentationState = { mode: 'reflow', pages: [] };
      this.model = {
        findNodeById: (nodes, nodeId) => nodes.find((node) => node.node_id === nodeId) || null,
      };
      this.resumeStore = {
        read: () => ({ node_id: 'chapter-44', candidate_id: 'candidate-1' }),
        clear() {},
      };
      this.resume = { sameCandidate: () => true };
      this.persisted = null;
    }

    async openBook() {
      this.renderNavigation();
      return this.restoreResumeLocation();
    }

    renderNavigation() {
      buttons.forEach((button, index) => {
        const entry = this.navigation[index];
        button.textContent = entry.label;
        button.addEventListener('click', () => this.navigateTo(entry.location));
      });
    }

    element(id) {
      return id === 'readerV2Navigation' ? nav : null;
    }

    async loadMore(options) {
      assert.equal(options.silent, true);
      assert.equal(options.deferRender, true);
      await new Promise((resolve) => { releaseResumeLoad = resolve; });
      this.nodes.push({ node_id: 'chapter-44', location: { node_id: 'chapter-44' } });
      chapter44Loaded = true;
      this.hasMore = false;
      return {};
    }

    reflowAndRender() {
      this.reflowCount = Number(this.reflowCount || 0) + 1;
    }

    locationForNode(nodeId) {
      return this.model.findNodeById(this.nodes, nodeId)?.location || null;
    }

    persistLocation(location) {
      this.lastLocation = location;
      this.persisted = location;
      this.resumeRecord = { node_id: location.node_id, candidate_id: 'candidate-1' };
      return this.resumeRecord;
    }

    setStatus(message) { statuses.push(message); }
    activateReaderSurface() {}
    presentationOptions() { return {}; }
    renderError(error) { throw error; }
  }

  installRuntime({
    documentObject,
    readerUI: {
      ReaderV2Controller: FakeReaderController,
      getDefaultController: () => null,
    },
  });

  const controller = new FakeReaderController();
  const opening = controller.openBook();
  assert.equal(typeof releaseResumeLoad, 'function');

  chapter37Button.click();
  assert.equal(controller.__previewExplicitNavigationGeneration, 1);
  assert.equal(chapter37Target.scrollCount, 1);
  assert.equal(controller.lastLocation.node_id, 'chapter-37');
  assert.equal(controller.persisted.node_id, 'chapter-37');

  releaseResumeLoad();
  await opening;

  assert.equal(chapter44Target.scrollCount, 0);
  assert.equal(controller.lastLocation.node_id, 'chapter-37');
  assert.equal(controller.resumeRecord.node_id, 'chapter-37');
  assert.equal(statuses.includes('已恢复上次阅读位置。'), false);
});
