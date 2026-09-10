const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Adapter = require('../speed-reading-adapter.js');
const Layout = require('../speed-reading-responsive-layout.js');
const Policy = require('../reader-punctuation-hanging-policy.js');

const documentView = {
  contract_version: '2',
  document_ref: 'doc-punctuation-regression',
  candidate_id: 'cand-punctuation-regression',
  candidate_schema_id: 'atlas.structured-content-v2',
  candidate_schema_version: 2,
  source_units: [{ source_unit_id: 'page-1', source_order: 0, kind: 'physical_page' }],
};

function paragraph(text) {
  return {
    node_id: 'paragraph-1',
    order: 0,
    node_type: 'paragraph',
    text,
    source_unit_ids: ['page-1'],
    location: {
      node_id: 'paragraph-1',
      source_unit_id: 'page-1',
      source_anchor: { kind: 'spatial', normalized_bbox: [0.1, 0.1, 0.9, 0.3] },
    },
  };
}

function measuredWidth(text) {
  let width = 0;
  for (const char of String(text || '')) {
    if (/\p{Script=Han}/u.test(char)) width += 10;
    else if (/\s/u.test(char)) width += 3;
    else width += 5;
  }
  return width;
}

function measuredLines(text, width = 100) {
  const elements = Adapter.buildReadingElements(documentView, [paragraph(text)]);
  return Layout.buildMeasuredLines(Adapter, elements, width, measuredWidth);
}

function frameFromLines(lines) {
  return {
    kind: 'timed_text',
    lines,
    text: lines.map((line) => line.text).join('\n'),
    reading_units: 0,
    duration_ms: 0,
  };
}

const timingAdapter = {
  countReadingUnits(text) { return Array.from(String(text || '')).length; },
  frameDurationMs(units) { return units * 10; },
};

test('measured layout lets only the closing punctuation exceed the line width', () => {
  const prefix = '甲'.repeat(9);
  const lines = measuredLines(`${prefix}观）后`);

  assert.deepEqual(lines.map((line) => line.text), [`${prefix}观）`, '后']);
  assert.equal(lines[0].measured_width_px, 105, 'the closing bracket may hang five pixels past the measured width');
  assert.equal(lines[1].text, '后');
});

test('when the character itself wraps, valid 观） stays together on the new line', () => {
  const prefix = '甲'.repeat(10);
  const lines = measuredLines(`${prefix}观）后续`);
  assert.deepEqual(lines.map((line) => line.text), [prefix, '观）后续']);

  const frame = frameFromLines(lines);
  Policy.repairHangingPunctuation([frame], timingAdapter, 600);
  assert.deepEqual(frame.lines.map((line) => line.text), [prefix, '观）后续']);
});

test('when the character itself wraps, valid 平， stays together on the new line', () => {
  const prefix = '乙'.repeat(10);
  const lines = measuredLines(`${prefix}平，直到`);
  assert.deepEqual(lines.map((line) => line.text), [prefix, '平，直到']);

  const frame = frameFromLines(lines);
  Policy.repairHangingPunctuation([frame], timingAdapter, 600);
  assert.deepEqual(frame.lines.map((line) => line.text), [prefix, '平，直到']);
});

test('fallback logical-width layout also hangs punctuation without moving the preceding character', () => {
  const tokens = Adapter.tokenizeReadingText(`${'甲'.repeat(10)}）后`);
  const lines = Adapter.tokensToLines(tokens, 10);
  const texts = lines.map((line) => line.tokens.map((token) => token.text).join(''));
  assert.deepEqual(texts, [`${'甲'.repeat(10)}）`, '后']);
});

test('legacy repair may move a punctuation-only prefix but never a character plus punctuation pair', () => {
  const identity = { node_id: 'paragraph-legacy', source_unit_id: 'page-1' };
  const punctuationOnly = {
    kind: 'timed_text',
    lines: [
      { text: '第一行', node_type: 'paragraph', identity },
      { text: '，第二行', node_type: 'paragraph', identity },
    ],
    text: '第一行\n，第二行',
  };
  Policy.repairHangingPunctuation([punctuationOnly], timingAdapter, 600);
  assert.deepEqual(punctuationOnly.lines.map((line) => line.text), ['第一行，', '第二行']);

  for (const nextLine of ['观）第二行', '平，第二行']) {
    const frame = {
      kind: 'timed_text',
      lines: [
        { text: '第一行', node_type: 'paragraph', identity },
        { text: nextLine, node_type: 'paragraph', identity },
      ],
      text: `第一行\n${nextLine}`,
    };
    Policy.repairHangingPunctuation([frame], timingAdapter, 600);
    assert.deepEqual(frame.lines.map((line) => line.text), ['第一行', nextLine]);
  }
});

test('the retired character-moving algorithms are absent from production sources', () => {
  const layoutSource = fs.readFileSync(require.resolve('../speed-reading-responsive-layout.js'), 'utf8');
  const policySource = fs.readFileSync(require.resolve('../reader-punctuation-hanging-policy.js'), 'utf8');

  assert.doesNotMatch(layoutSource, /moveTrailingTokenToNextLine/u);
  assert.doesNotMatch(policySource, /CARRIED_CHARACTER_AND_PUNCTUATION/u);
  assert.match(policySource, /LEADING_CLOSING_PUNCTUATION/u);
});