const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Layout = require('../reader-semantic-layout-harmonizer.js');

function element(nodeType, bbox, extra = {}) {
  return {
    normalized_bbox: bbox,
    node: { node_type: nodeType, ...extra },
  };
}

test('body text uses one canonical book page frame while wide visuals are centered', () => {
  assert.deepEqual(
    Layout.canonicalHorizontalBbox(element('paragraph', [0.18, 0.2, 0.82, 0.3]), [0.1, 0.9]),
    [0.1, 0.2, 0.9, 0.3],
  );
  assert.deepEqual(
    Layout.canonicalHorizontalBbox(element('heading', [0.32, 0.12, 0.68, 0.18]), [0.1, 0.9]),
    [0.1, 0.12, 0.9, 0.18],
  );
  const centered = Layout.canonicalHorizontalBbox(
    element('figure', [0.18, 0.35, 0.78, 0.65]),
    [0.1, 0.9],
  );
  assert.ok(Math.abs(centered[0] - 0.2) < 1e-12);
  assert.ok(Math.abs(centered[2] - 0.8) < 1e-12);

  assert.deepEqual(
    Layout.canonicalHorizontalBbox(element('figure', [0.12, 0.35, 0.28, 0.45]), [0.1, 0.9]),
    [0.12, 0.35, 0.28, 0.45],
    'small inline/decorative figures keep their horizontal source position',
  );
});

test('vertical flow caps excessive whitespace and turns source overlap into safe gaps', () => {
  const plan = Layout.computeFlowPlan([
    { index: 0, type: 'heading', bbox: [0.1, 0.20, 0.9, 0.24], renderedHeight: 50 },
    { index: 1, type: 'paragraph', bbox: [0.1, 0.40, 0.9, 0.48], renderedHeight: 80 },
    { index: 2, type: 'paragraph', bbox: [0.1, 0.47, 0.9, 0.55], renderedHeight: 90 },
  ], 1000);

  assert.equal(plan.placements[0].top, 140, 'large page-top source whitespace is capped');
  assert.equal(plan.placements[1].top, 212, 'large heading-to-body source gap is capped');
  assert.equal(plan.placements[2].top, 302, 'overlapping source boxes receive a minimum paragraph gap');
  for (let index = 1; index < plan.placements.length; index += 1) {
    assert.ok(plan.placements[index].top >= plan.placements[index - 1].bottom);
  }
  assert.equal(plan.requiredHeight, 440);
});

test('visual/caption spacing stays tighter than normal section spacing', () => {
  assert.deepEqual(Layout.flowGapBounds('figure', 'caption'), { minimum: 6, maximum: 13 });
  assert.deepEqual(Layout.flowGapBounds('paragraph', 'heading'), { minimum: 19, maximum: 34 });
  assert.equal(Layout.compactSourceGap(200, 'figure', 'caption'), 13);
  assert.equal(Layout.compactSourceGap(-20, 'paragraph', 'paragraph'), 10);
});

test('inline math parser separates sentence math from prose without treating currency as math', () => {
  const segments = Layout.parseInlineMathSegments(
    '因为 $A \\cap B$ 与 \\(P(A)\\) 有关，表中为 $\\pm1.5\\sigma$。',
  );
  assert.deepEqual(
    segments.filter((segment) => segment.kind === 'math').map((segment) => [segment.source, segment.displayMode]),
    [
      ['A \\cap B', false],
      ['P(A)', false],
      ['\\pm1.5\\sigma', false],
    ],
  );
  assert.deepEqual(Layout.parseInlineMathSegments('价格是 $5，没有闭合公式。'), [
    { kind: 'text', text: '价格是 $5，没有闭合公式。' },
  ]);
});

test('inline math renderer preserves prose and sends only math spans to KaTeX', () => {
  const children = [];
  const target = {
    children,
    replaceChildren() { children.splice(0); },
    appendChild(child) { children.push(child); return child; },
  };
  const wrapper = {
    dataset: {},
    querySelector(selector) { return selector === '.reader-v2-node-text' ? target : null; },
  };
  const documentObject = {
    createTextNode(text) { return { nodeType: 3, textContent: text }; },
    createElement(tag) {
      return {
        tagName: tag.toUpperCase(),
        className: '',
        textContent: '',
        children: [],
        appendChild(child) { this.children.push(child); return child; },
      };
    },
  };
  const calls = [];
  const controller = {
    document: documentObject,
    currentFindResult() { return null; },
  };
  const root = {
    katex: {
      render(source, targetElement, options) {
        calls.push({ source, options });
        targetElement.textContent = `MATH:${source}`;
      },
    },
  };
  const node = {
    node_id: 'p1',
    node_type: 'paragraph',
    text: '事件 $A \\cup B$ 的概率是 \\(P(A \\cup B)\\)。',
  };

  assert.equal(Layout.renderInlineMathInWrapper(controller, node, wrapper, root), true);
  assert.deepEqual(calls.map((call) => call.source), ['A \\cup B', 'P(A \\cup B)']);
  assert.ok(calls.every((call) => call.options.displayMode === false));
  assert.equal(wrapper.dataset.readerInlineMath, '1');
  assert.ok(children.some((child) => child.textContent === '事件 '));
  assert.ok(children.some((child) => child.textContent === 'MATH:A \\cup B'));
});

test('harmonizer styling establishes consistent body typography and justified reflow', () => {
  assert.match(Layout.STYLE_TEXT, /--reader-semantic-body-font-size:\s*16px/);
  assert.match(Layout.STYLE_TEXT, /white-space:\s*normal/);
  assert.match(Layout.STYLE_TEXT, /text-align:\s*justify/);
  assert.match(Layout.STYLE_TEXT, /text-justify:\s*inter-ideograph/);
  assert.match(Layout.STYLE_TEXT, /reader-v2-inline-math/);
});

test('semantic page bootstrap installs harmonizer before semantic page integration', () => {
  const source = fs.readFileSync('reader-presentation.js', 'utf8');
  const semanticIndex = source.indexOf("'reader-semantic-page.js'");
  const harmonizerIndex = source.indexOf("'reader-semantic-layout-harmonizer.js'");
  const installIndex = source.indexOf('ReaderSemanticLayoutHarmonizerV2.install');
  const integrationIndex = source.indexOf("'reader-semantic-page-integration.js'");
  assert.ok(semanticIndex >= 0);
  assert.ok(harmonizerIndex > semanticIndex);
  assert.ok(installIndex > harmonizerIndex);
  assert.ok(integrationIndex > installIndex);
});
