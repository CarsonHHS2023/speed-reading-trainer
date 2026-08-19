const test = require('node:test');
const assert = require('node:assert/strict');

const Formula = require('../reader-formula.js');

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this.textContent = '';
    this.tabIndex = 0;
    this.style = {};
    this.parentElement = null;
    this.parentNode = null;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    this.children.splice(this.children.indexOf(child), 1);
    child.parentElement = null;
    child.parentNode = null;
    return child;
  }

  replaceChildren(...children) {
    for (const child of this.children) {
      child.parentElement = null;
      child.parentNode = null;
    }
    this.children = [];
    for (const child of children) this.appendChild(child);
  }

  get firstChild() {
    return this.children[0] || null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
}

class FakeDocument {
  createElement(tag) {
    return new FakeElement(tag);
  }
}

test('provider diagnostic fields are removed before formula normalization', () => {
  const diagnosticOnly = [
    'label: formula',
    'bbox: [1,2,3,4]',
    'content:',
  ].join('\n');

  assert.equal(Formula.stripProviderDiagnostics(diagnosticOnly), '');
  assert.deepEqual(Formula.normalizeFormulaSource(diagnosticOnly), {
    original: '',
    source: '',
    delimiter: null,
  });

  const diagnosticWithMath = [
    'label: formula',
    'bbox: [1,2,3,4]',
    'content:',
    '$$ x^2 + y^2 $$',
  ].join('\n');

  assert.deepEqual(Formula.normalizeFormulaSource(diagnosticWithMath), {
    original: '$$ x^2 + y^2 $$',
    source: 'x^2 + y^2',
    delimiter: 'double-dollar',
  });
});

test('asset-backed provider diagnostics delegate to the original asset renderer', () => {
  const katexCalls = [];
  const scheduled = [];

  class Controller {
    constructor() {
      this.document = new FakeDocument();
      this.legacyCalls = [];
    }

    renderNode(node) {
      this.legacyCalls.push(node);
      return { legacyNodeType: node.node_type, assetRefs: node.asset_refs };
    }

    currentFindResult() {
      return null;
    }
  }

  const root = {
    ReaderUIV2: { ReaderV2Controller: Controller },
    ReaderSemanticPageV2: { VISUAL_NODE_TYPES: new Set(['figure', 'table', 'formula']) },
    katex: {
      render(source) {
        katexCalls.push(source);
      },
    },
    requestAnimationFrame(callback) {
      scheduled.push(callback);
    },
    setTimeout(callback) {
      callback();
    },
  };

  Formula.installFormulaRendering({ root });
  const controller = new Controller();
  const node = {
    node_id: 'formula-provider-diagnostic',
    node_type: 'formula',
    text: 'label: formula\nbbox: [1,2,3,4]\ncontent:',
    asset_refs: ['asset-formula-image'],
  };

  const rendered = controller.renderNode(node);

  assert.deepEqual(rendered, {
    legacyNodeType: 'formula',
    assetRefs: ['asset-formula-image'],
  });
  assert.equal(controller.legacyCalls.length, 1);
  assert.deepEqual(katexCalls, []);
  assert.equal(scheduled.length, 0);
  assert.equal(root.ReaderSemanticPageV2.VISUAL_NODE_TYPES.has('formula'), true);
});

test('provider diagnostics without an asset use the unavailable-text fallback', () => {
  class Controller {
    constructor() {
      this.document = new FakeDocument();
      this.legacyCalls = 0;
    }

    renderNode(node) {
      this.legacyCalls += 1;
      return { legacyNodeType: node.node_type };
    }

    currentFindResult() {
      return null;
    }
  }

  const scheduled = [];
  const root = {
    ReaderUIV2: { ReaderV2Controller: Controller },
    ReaderSemanticPageV2: { VISUAL_NODE_TYPES: new Set(['figure', 'table', 'formula']) },
    katex: {
      render() {
        throw new Error('diagnostic text must not reach KaTeX');
      },
    },
    requestAnimationFrame(callback) {
      scheduled.push(callback);
    },
    setTimeout(callback) {
      callback();
    },
  };

  Formula.installFormulaRendering({ root });
  const controller = new Controller();
  const rendered = controller.renderNode({
    node_id: 'formula-provider-diagnostic-no-asset',
    node_type: 'formula',
    text: 'label: formula\nbbox: [1,2,3,4]\ncontent:',
    asset_refs: [],
  });

  assert.equal(controller.legacyCalls, 0);
  assert.equal(rendered.dataset.formulaRendering, 'fallback');
  assert.equal(rendered.children[0].children[0].textContent, '公式内容不可用');
  assert.equal(rendered.children[0].dataset.formulaSource, '');
  assert.equal(scheduled.length, 1);
});
