const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const BaseAdapter = require('../speed-reading-adapter.js');
const Formula = require('../reader-formula.js');
const ResponsiveLayout = require('../speed-reading-responsive-layout.js');
const FormulaRendering = require('../speed-reading-formula-rendering.js');

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this.textContent = '';
    this.listeners = [];
    this.firstChild = null;
  }
  appendChild(child) {
    this.children.push(child);
    this.firstChild = this.children[0] || null;
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((item) => item !== child);
    this.firstChild = this.children[0] || null;
    return child;
  }
  replaceChildren(...children) {
    this.children = [];
    this.firstChild = null;
    for (const child of children) this.appendChild(child);
    this.textContent = '';
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(type, callback) { this.listeners.push({ type, callback }); }
}

class FakeDocument {
  constructor() { this.defaultView = null; }
  createElement(tag) { return new FakeElement(tag); }
}

test('inline math tokenizer keeps one formula atomic through line and block layout', () => {
  const adapter = { ...BaseAdapter };
  assert.equal(FormulaRendering.installAdapterFormulaTokens(adapter, Formula), true);

  const text = '甲 \\(A \\cap B\\) 乙';
  const tokens = adapter.tokenizeReadingText(text, { normalizeSoftWraps: true });
  const formulaTokens = tokens.filter((token) => token.kind === 'inline_formula');
  assert.equal(formulaTokens.length, 1);
  assert.equal(formulaTokens[0].formula_source, 'A \\cap B');
  assert.equal(formulaTokens[0].text, '\\(A \\cap B\\)');

  const lines = ResponsiveLayout.buildMeasuredLines(adapter, [{
    text,
    node_type: 'paragraph',
    heading_level: null,
    identity: { node_id: 'inline-1', source_unit_id: 'page-1' },
  }], 30, (value) => String(value).length * 5);

  const formulaLine = lines.find((line) => line.tokens.some((token) => token.kind === 'inline_formula'));
  assert.ok(formulaLine);
  assert.equal(formulaLine.tokens.filter((token) => token.kind === 'inline_formula').length, 1);
  const blocks = ResponsiveLayout.splitMeasuredLineIntoBlocks(formulaLine, 10);
  assert.equal(blocks.filter((block) => block.tokens.some((token) => token.kind === 'inline_formula')).length, 1);
});

test('inline formula renderer uses KaTeX inline mode and removes TeX delimiters from visible content', () => {
  const documentObject = new FakeDocument();
  const row = documentObject.createElement('div');
  const calls = [];
  const root = {
    katex: {
      render(source, target, options) {
        calls.push({ source, options });
        target.textContent = `rendered:${source}`;
      },
    },
  };
  const line = {
    text: '甲 \\(A \\cap B\\) 乙',
    tokens: [
      { kind: 'cjk', text: '甲' },
      { kind: 'space', text: ' ' },
      { kind: 'inline_formula', text: '\\(A \\cap B\\)', formula_source: 'A \\cap B', formula_delimiter: 'inline-parenthesis' },
      { kind: 'space', text: ' ' },
      { kind: 'cjk', text: '乙' },
    ],
  };

  assert.equal(FormulaRendering.renderStructuredLineFormula({ documentObject, row, line, root, formulaApi: Formula }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, 'A \\cap B');
  assert.equal(calls[0].options.displayMode, false);
  assert.equal(calls[0].options.throwOnError, true);
  assert.equal(calls[0].options.trust, false);
  assert.equal(row.children[1].className, 'reader-playback-inline-formula');
  assert.equal(row.children[1].textContent, 'rendered:A \\cap B');
});

test('manual display-formula frame uses shared ReaderFormula KaTeX display rendering instead of raw TeX text', () => {
  const documentObject = new FakeDocument();
  const calls = [];
  let assetCalls = 0;

  class Controller {
    constructor() {
      this.document = documentObject;
      this.assets = { renderAssetInto() { assetCalls += 1; return Promise.resolve(); } };
      this.reader = {};
      this.continueCalls = 0;
    }
    renderFrame() {}
    renderManualFrame() { throw new Error('legacy manual renderer should not handle formula'); }
    continueManual() { this.continueCalls += 1; }
  }

  const root = {
    ReaderSpeedPlaybackUI: { ReaderSpeedPlaybackUIController: Controller },
    katex: {
      render(source, target, options) {
        calls.push({ source, options });
        target.textContent = `display:${source}`;
      },
    },
  };
  documentObject.defaultView = root;

  assert.equal(FormulaRendering.installPlaybackFormulaRendering(root, Formula), true);
  const controller = new Controller();
  const target = documentObject.createElement('div');
  controller.renderManualFrame({
    kind: 'manual',
    node_type: 'formula',
    text: '$$ P(A_{2})=P(A_{1})-P(A_{2}-\\lambda_{1}) $$',
    asset_refs: [],
    identity: { node_id: 'formula-1' },
  }, target);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].source, 'P(A_{2})=P(A_{1})-P(A_{2}-\\lambda_{1})');
  assert.equal(calls[0].options.displayMode, true);
  assert.equal(assetCalls, 0);
  assert.equal(target.children[0].className, 'reader-playback-asset-slot reader-playback-formula-slot');
  assert.equal(target.children[0].children[0].dataset.formulaRendering, 'katex');
  assert.equal(target.children[1].className, 'reader-playback-continue');
});

test('canonical lifecycle installs formula rendering after the measured renderer chain exists', () => {
  const source = fs.readFileSync(require.resolve('../reader-resume-lifecycle.js'), 'utf8');
  const responsive = source.indexOf('speed-reading-responsive-layout.js');
  const punctuation = source.indexOf('reader-punctuation-hanging-policy.js');
  const formula = source.indexOf('speed-reading-formula-rendering.js');
  assert.ok(responsive >= 0 && punctuation > responsive && formula > punctuation);
  assert.match(source, /function versionedAsset\(src, documentObject/u);
  assert.match(source, /script\.src = versionedAsset\(src\)/u);
  assert.match(source, /script\.dataset\.readerEnhancement = src/u);
});