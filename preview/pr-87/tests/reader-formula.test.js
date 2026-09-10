const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

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
  get firstChild() { return this.children[0] || null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
}

class FakeDocument {
  createElement(tag) { return new FakeElement(tag); }
}

test('formula source normalization removes only matching outer math delimiters', () => {
  assert.deepEqual(Formula.normalizeFormulaSource('$$ F=P\\times(1+i)^{n} $$'), {
    original: '$$ F=P\\times(1+i)^{n} $$',
    source: 'F=P\\times(1+i)^{n}',
    delimiter: 'double-dollar',
  });
  assert.equal(Formula.normalizeFormulaSource('\\[x^2\\]').source, 'x^2');
  assert.equal(Formula.normalizeFormulaSource('\\(x+1\\)').source, 'x+1');
  assert.equal(Formula.normalizeFormulaSource('$x$').source, 'x');
  assert.equal(Formula.normalizeFormulaSource('cost is $5').source, 'cost is $5');
});

test('formula renderer sends normalized TeX to KaTeX with safe display options', () => {
  const documentObject = new FakeDocument();
  const target = documentObject.createElement('div');
  const calls = [];
  const katex = {
    render(source, element, options) {
      calls.push({ source, element, options });
      element.textContent = 'rendered math';
    },
  };

  const result = Formula.renderFormulaInto({
    documentObject,
    target,
    text: '$$ F=P\\times(1+i)^{n} $$',
    katex,
  });

  assert.equal(result.rendered, true);
  assert.equal(result.source, 'F=P\\times(1+i)^{n}');
  assert.equal(target.dataset.formulaRendering, 'katex');
  assert.equal(target.dataset.formulaDelimiter, 'double-dollar');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, 'F=P\\times(1+i)^{n}');
  assert.equal(calls[0].options.displayMode, true);
  assert.equal(calls[0].options.throwOnError, true);
  assert.equal(calls[0].options.trust, false);
  assert.equal(calls[0].options.output, 'htmlAndMathml');
});

test('missing or invalid KaTeX safely falls back to readable formula text', () => {
  const documentObject = new FakeDocument();
  const missingTarget = documentObject.createElement('div');
  Formula.renderFormulaInto({
    documentObject,
    target: missingTarget,
    text: '$$ F=P\\times(1+i)^{n} $$',
  });
  assert.equal(missingTarget.dataset.formulaRendering, 'fallback');
  assert.equal(missingTarget.children[0].textContent, 'F=P\\times(1+i)^{n}');

  const invalidTarget = documentObject.createElement('div');
  Formula.renderFormulaInto({
    documentObject,
    target: invalidTarget,
    text: '$$ \\badcommand $$',
    katex: { render() { throw new Error('parse failed'); } },
  });
  assert.equal(invalidTarget.dataset.formulaRendering, 'fallback');
  assert.equal(invalidTarget.children[0].textContent, '\\badcommand');
});

test('installed renderer preserves formula visual classification until actual rendering is known', () => {
  class Controller {
    constructor() {
      this.document = new FakeDocument();
    }
    renderNode(node) { return { legacyNodeType: node.node_type }; }
    currentFindResult() { return null; }
  }
  const calls = [];
  const scheduled = [];
  const root = {
    ReaderUIV2: { ReaderV2Controller: Controller },
    ReaderSemanticPageV2: { VISUAL_NODE_TYPES: new Set(['figure', 'table', 'formula']) },
    katex: {
      render(source, target) {
        calls.push(source);
        target.textContent = 'rendered';
      },
    },
    requestAnimationFrame(callback) { scheduled.push(callback); },
    setTimeout(callback) { callback(); },
  };

  assert.equal(Formula.installFormulaRendering({ root }), true);
  assert.equal(root.ReaderSemanticPageV2.VISUAL_NODE_TYPES.has('formula'), true);
  assert.equal(root.ReaderSemanticPageV2.VISUAL_NODE_TYPES.has('figure'), true);

  const controller = new Controller();
  const formulaNode = {
    node_id: 'formula-1',
    node_type: 'formula',
    text: '$$ F=P\\times(1+i)^{n} $$',
    content_state: 'ready',
    asset_refs: ['asset-formula-image'],
  };
  const rendered = controller.renderNode(formulaNode);
  assert.equal(rendered.className, 'reader-v2-node reader-v2-node-formula');
  assert.equal(rendered.dataset.readerNodeId, 'formula-1');
  assert.equal(rendered.dataset.formulaRendering, 'katex');
  assert.equal(rendered.children[0].className, 'reader-v2-formula');
  assert.deepEqual(calls, ['F=P\\times(1+i)^{n}']);
  assert.equal(scheduled.length, 1);
  assert.deepEqual(controller.renderNode({ node_type: 'paragraph' }), { legacyNodeType: 'paragraph' });
});

test('KaTeX and readable fallbacks convert their semantic visual slot to expandable text layout', () => {
  const scheduled = [];
  class Controller {
    constructor() { this.document = new FakeDocument(); }
    renderNode(node) { return { legacyNodeType: node.node_type }; }
    currentFindResult() { return null; }
  }
  const root = {
    ReaderUIV2: { ReaderV2Controller: Controller },
    ReaderSemanticPageV2: { VISUAL_NODE_TYPES: new Set(['figure', 'table', 'formula']) },
    katex: { render(_source, target) { target.textContent = 'rendered'; } },
    requestAnimationFrame(callback) { scheduled.push(callback); },
    setTimeout(callback) { callback(); },
  };
  Formula.installFormulaRendering({ root });

  const controller = new Controller();
  const rendered = controller.renderNode({
    node_id: 'formula-layout',
    node_type: 'formula',
    text: '$$ x^2 $$',
    asset_refs: [],
  });
  const slot = new FakeElement('div');
  slot.className = 'reader-v2-semantic-page-element reader-v2-semantic-page-element--visual';
  slot.style.height = '2%';
  slot.style.overflow = 'hidden';
  slot.appendChild(rendered);

  assert.equal(scheduled.length, 1);
  scheduled[0]();

  assert.match(slot.className, /reader-v2-semantic-page-element--text/);
  assert.doesNotMatch(slot.className, /reader-v2-semantic-page-element--visual/);
  assert.equal(slot.style.height, 'auto');
  assert.equal(slot.style.overflow, 'visible');
  assert.equal(slot.dataset.readerFormulaLayout, 'text');
});

test('asset-backed formulas delegate to the original renderer without demoting the visual slot', () => {
  function createController(katex) {
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
      currentFindResult() { return null; }
    }
    const root = {
      ReaderUIV2: { ReaderV2Controller: Controller },
      ReaderSemanticPageV2: { VISUAL_NODE_TYPES: new Set(['figure', 'table', 'formula']) },
      katex,
      requestAnimationFrame(callback) { scheduled.push(callback); },
      setTimeout(callback) { callback(); },
    };
    Formula.installFormulaRendering({ root });
    return { controller: new Controller(), root, scheduled };
  }

  const missingKatex = createController(null);
  const missingResult = missingKatex.controller.renderNode({
    node_id: 'formula-missing-katex',
    node_type: 'formula',
    text: '$$ x^2 $$',
    asset_refs: ['asset-1'],
  });
  assert.deepEqual(missingResult, { legacyNodeType: 'formula', assetRefs: ['asset-1'] });
  assert.equal(missingKatex.controller.legacyCalls.length, 1);
  assert.equal(missingKatex.root.ReaderSemanticPageV2.VISUAL_NODE_TYPES.has('formula'), true);
  assert.equal(missingKatex.scheduled.length, 0);

  const invalidKatex = createController({ render() { throw new Error('invalid TeX'); } });
  const invalidResult = invalidKatex.controller.renderNode({
    node_id: 'formula-invalid',
    node_type: 'formula',
    text: '$$ \\badcommand $$',
    asset_refs: ['asset-2'],
  });
  assert.deepEqual(invalidResult, { legacyNodeType: 'formula', assetRefs: ['asset-2'] });
  assert.equal(invalidKatex.controller.legacyCalls.length, 1);
  assert.equal(invalidKatex.scheduled.length, 0);

  const emptySource = createController({ render() { throw new Error('must not render empty source'); } });
  const emptyResult = emptySource.controller.renderNode({
    node_id: 'formula-empty',
    node_type: 'formula',
    text: '   ',
    asset_refs: ['asset-3'],
  });
  assert.deepEqual(emptyResult, { legacyNodeType: 'formula', assetRefs: ['asset-3'] });
  assert.equal(emptySource.controller.legacyCalls.length, 1);
  assert.equal(emptySource.scheduled.length, 0);
});

test('formula nodes without assets keep readable fallback text when KaTeX is unavailable', () => {
  class Controller {
    constructor() {
      this.document = new FakeDocument();
      this.legacyCalls = 0;
    }
    renderNode(node) {
      this.legacyCalls += 1;
      return { legacyNodeType: node.node_type };
    }
    currentFindResult() { return null; }
  }
  const root = {
    ReaderUIV2: { ReaderV2Controller: Controller },
    ReaderSemanticPageV2: { VISUAL_NODE_TYPES: new Set(['figure', 'table', 'formula']) },
    requestAnimationFrame() {},
    setTimeout(callback) { callback(); },
  };
  Formula.installFormulaRendering({ root });

  const controller = new Controller();
  const rendered = controller.renderNode({
    node_id: 'formula-text-fallback',
    node_type: 'formula',
    text: '$$ x^2 $$',
    asset_refs: [],
  });

  assert.equal(controller.legacyCalls, 0);
  assert.equal(rendered.dataset.formulaRendering, 'fallback');
  assert.equal(rendered.children[0].children[0].textContent, 'x^2');
});

test('main page loads pinned KaTeX and formula integration after Reader UI', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /katex@0\.18\.1\/dist\/katex\.min\.css/);
  assert.match(html, /katex@0\.18\.1\/dist\/katex\.min\.js/);
  assert.match(html, /reader-formula\.css/);
  assert.match(html, /reader-formula\.js/);
  assert.ok(html.indexOf('reader-ui-v2.js') < html.indexOf('reader-formula.js'));
});
