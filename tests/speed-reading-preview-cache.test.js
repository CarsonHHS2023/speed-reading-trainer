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
  assert.match(clock, /FALLBACK_ASSET_VERSION = '2026-08-09-speed-reading-core-v1'/u);
  assert.match(clock, /function currentScriptAssetVersion\(documentObject\)/u);
  assert.match(clock, /const entrypointVersion = currentScriptAssetVersion\(document\)/u);
  assert.match(clock, /const assetVersion = previewHead \|\| entrypointVersion \|\| FALLBACK_ASSET_VERSION/u);
  assert.match(clock, /const versionedSrc = \(src\) => `\$\{src\}\?v=\$\{encodeURIComponent\(assetVersion\)\}`/u);
  assert.match(clock, /speed-reading-structure-policy\.js/u);
  assert.match(clock, /speed-reading-formula-rendering\.js/u);
  assert.match(clock, /speed-reading-responsive-layout\.js/u);
  assert.match(clock, /speed-reading-layout-integrity\.js/u);
  assert.match(clock, /script\.dataset\.readerEnhancement = src/u);
  assert.match(clock, /script\.dataset\.loaded = '1'/u);

  assert.match(workflow, /"training-session-clock\.js"/u);
  assert.match(workflow, /"reader-resume-lifecycle\.js"/u);
  assert.match(workflow, /training-session-clock\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /reader-resume-lifecycle\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /speed-reading-structure-policy\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /speed-reading-responsive-layout\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /speed-reading-formula-rendering\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /speed-reading-layout-integrity\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /FALLBACK_ASSET_VERSION = '2026-08-09-speed-reading-core-v1'/u);
  assert.match(workflow, /currentScriptAssetVersion/u);
  assert.match(workflow, /dataset\.readerEnhancement/u);
  assert.match(workflow, /inline_formula: 'paragraph'/u);
  assert.match(workflow, /MIN_WIDTH_PERCENT = 20/u);
  assert.match(workflow, /splitMeasuredLineIntoBlocks/u);
  assert.match(workflow, /pageLineCapacity/u);
  assert.match(workflow, /displayMode: false/u);
  assert.match(workflow, /rendererChainReady/u);
  assert.match(workflow, /canonicalCaptionAssociations/u);
  assert.match(workflow, /lineFrameCapacity/u);
  assert.match(workflow, /applySafeHorizontalInset/u);
  assert.match(workflow, /withPlaybackElementPolicy/u);
  assert.match(workflow, /GLYPH_BLEED_PX = 6/u);
  assert.match(workflow, /relaxTimedTextClipping/u);
});

test('Production Pages binds entrypoint assets to the deployed main commit', () => {
  const workflow = fs.readFileSync('.github/workflows/pages.yml', 'utf8');
  assert.match(workflow, /Prepare cache-busted production entrypoint/u);
  assert.match(workflow, /PRODUCTION_HEAD_SHA: \$\{\{ github\.sha \}\}/u);
  assert.match(workflow, /"training-session-clock\.js"/u);
  assert.match(workflow, /"reader-resume-lifecycle\.js"/u);
  assert.match(workflow, /f"\{asset\}\?v=\{sha\}"/u);
  assert.match(workflow, /re\.sub/u);
});
