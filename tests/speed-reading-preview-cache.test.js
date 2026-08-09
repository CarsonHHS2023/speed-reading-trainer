const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Lifecycle = require('../reader-resume-lifecycle.js');

function fakePreviewDocument(head) {
  return {
    querySelector(selector) {
      if (selector !== 'meta[name="reader-preview-head"]') return null;
      return { getAttribute: (name) => name === 'content' ? head : null };
    },
  };
}

test('Preview bootstraps speed-reading enhancement assets from the exact deployed head', () => {
  const head = 'abc123previewhead';
  const documentObject = fakePreviewDocument(head);
  assert.equal(Lifecycle.previewHeadVersion(documentObject), head);
  assert.equal(Lifecycle.assetVersion(documentObject), head);
  assert.equal(Lifecycle.versionedAsset('speed-reading-structure-policy.js', documentObject), `speed-reading-structure-policy.js?v=${head}`);
  assert.equal(Lifecycle.versionedAsset('speed-reading-responsive-layout.js', documentObject), `speed-reading-responsive-layout.js?v=${head}`);

  const clock = fs.readFileSync('training-session-clock.js', 'utf8');
  const workflow = fs.readFileSync('.github/workflows/preview.yml', 'utf8');

  assert.match(clock, /meta\[name="reader-preview-head"\]/u);
  assert.match(clock, /speed-reading-formula-rendering\.js\?v=\$\{encodeURIComponent\(previewHead\)\}/u);
  assert.match(clock, /speed-reading-responsive-layout\.js\?v=\$\{encodeURIComponent\(previewHead\)\}/u);
  assert.match(clock, /speed-reading-layout-integrity\.js\?v=\$\{encodeURIComponent\(previewHead\)\}/u);
  assert.match(workflow, /"training-session-clock\.js"/u);
  assert.match(workflow, /"reader-resume-lifecycle\.js"/u);
  assert.match(workflow, /training-session-clock\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /reader-resume-lifecycle\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /speed-reading-structure-policy\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /speed-reading-responsive-layout\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /speed-reading-formula-rendering\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /speed-reading-layout-integrity\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /inline_formula: 'paragraph'/u);
  assert.match(workflow, /MIN_WIDTH_PERCENT = 20/u);
  assert.match(workflow, /splitMeasuredLineIntoBlocks/u);
  assert.match(workflow, /pageLineCapacity/u);
  assert.match(workflow, /displayMode: false/u);
  assert.match(workflow, /rendererChainReady/u);
  assert.match(workflow, /canonicalCaptionAssociations/u);
  assert.match(workflow, /lineFrameCapacity/u);
  assert.match(workflow, /applySafeHorizontalInset/u);
  assert.match(workflow, /scopedNodeKey/u);
  assert.match(workflow, /sourceUnitIdForNode/u);
  assert.match(workflow, /canonicalPlaybackElementOrder/u);
  assert.match(workflow, /relaxTimedTextClipping/u);
});
