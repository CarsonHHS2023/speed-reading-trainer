const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'preview-runtime.js'), 'utf8');

function makeButton(label) {
  const attributes = new Map();
  return {
    dataset: {},
    textContent: label,
    disabled: false,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name); },
  };
}

function installRuntime({ documentObject, readerUI, requestAnimationFrame }) {
  const windowObject = {
    location: {
      pathname: '/speed-reading-trainer/preview/pr-70/',
      href: 'https://carsonhhs2023.github.io/speed-reading-trainer/preview/pr-70/',
    },
    fetch: async () => ({ ok: true }),
    Request: global.Request,
    document: documentObject,
    ReaderUIV2: readerUI,
    requestAnimationFrame,
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

test('long TOC navigation reports progress on the clicked chapter itself', async () => {
  const navButton = makeButton('第44章');
  const nav = {
    querySelectorAll(selector) {
      return selector === '.reader-v2-nav-item' ? [navButton] : [];
    },
  };
  const main = {
    dataset: {},
    scrollHeight: 0,
    scrollTop: 0,
    clientHeight: 0,
    addEventListener() {},
  };
  const target = {
    scrollIntoView() {},
    focus() {},
  };

  let loadedTarget = false;
  let releaseLoad = null;
  let releaseFrame = null;
  const statuses = [];

  const documentObject = {
    readyState: 'complete',
    activeElement: navButton,
    querySelector(selector) {
      if (selector === '.reader-v2-main') return main;
      if (selector.includes('chapter-44') && loadedTarget) return target;
      return null;
    },
  };

  class FakeReaderController {
    constructor() {
      this.document = documentObject;
      this.navigation = [{ label: '第44章', location: { node_id: 'chapter-44' } }];
      this.nodes = [{ node_id: 'start' }];
      this.hasMore = true;
      this.model = {
        findNodeById: (nodes, nodeId) => nodes.find((node) => node.node_id === nodeId) || null,
      };
    }

    renderNavigation() {
      navButton.textContent = '第44章';
    }

    element(id) {
      return id === 'readerV2Navigation' ? nav : null;
    }

    async loadMore(options) {
      assert.equal(options.silent, true);
      await new Promise((resolve) => { releaseLoad = resolve; });
      this.nodes.push({ node_id: 'chapter-44', location: { node_id: 'chapter-44' } });
      this.hasMore = false;
      loadedTarget = true;
      return {};
    }

    setStatus(message) { statuses.push(message); }
    locationForNode(nodeId) { return { node_id: nodeId }; }
    persistLocation(location) { this.persisted = location; }
    renderError(error) { throw error; }
  }

  installRuntime({
    documentObject,
    readerUI: {
      ReaderV2Controller: FakeReaderController,
      getDefaultController: () => null,
    },
    requestAnimationFrame(callback) { releaseFrame = callback; },
  });

  const controller = new FakeReaderController();
  controller.renderNavigation();
  assert.equal(navButton.dataset.readerNavNodeId, 'chapter-44');

  const navigation = controller.navigateTo({ node_id: 'chapter-44' });
  await Promise.resolve();
  assert.equal(navButton.disabled, true);
  assert.equal(navButton.getAttribute('aria-busy'), 'true');
  assert.equal(navButton.textContent, '⏳ 第44章 · 正在定位…');

  releaseLoad();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(navButton.textContent, '⏳ 第44章 · 已加载 2 个内容块');

  releaseFrame();
  assert.equal(await navigation, true);
  assert.equal(navButton.textContent, '第44章');
  assert.equal(navButton.disabled, false);
  assert.equal(navButton.getAttribute('aria-busy'), undefined);
  assert.equal(controller.persisted.node_id, 'chapter-44');
  assert.equal(statuses.at(-1), '');
});
