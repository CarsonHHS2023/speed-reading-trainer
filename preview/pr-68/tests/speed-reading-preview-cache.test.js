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

function fakeProductionDocument(version) {
  return {
    baseURI: 'https://example.test/',
    currentScript: { src: `https://example.test/reader-resume-lifecycle.js?v=${version}` },
    querySelector() { return null; },
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
  const lifecycleSource = fs.readFileSync('reader-resume-lifecycle.js', 'utf8');
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
  assert.match(clock, /reader-punctuation-hanging-policy\.js/u);
  assert.match(clock, /speed-reading-layout-integrity\.js/u);
  assert.match(clock, /script\.dataset\.readerEnhancement = src/u);
  assert.match(clock, /script\.dataset\.loaded = '1'/u);

  assert.match(lifecycleSource, /const ENTRYPOINT_ASSET_VERSION = currentScriptAssetVersion/u);
  assert.match(lifecycleSource, /\|\| ENTRYPOINT_ASSET_VERSION/u);
  assert.match(lifecycleSource, /document\.currentScript is only reliable while this entrypoint is executing/u);

  assert.match(workflow, /"training-session-clock\.js"/u);
  assert.match(workflow, /"reader-resume-lifecycle\.js"/u);
  assert.match(workflow, /training-session-clock\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /reader-resume-lifecycle\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /speed-reading-structure-policy\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /speed-reading-responsive-layout\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /reader-punctuation-hanging-policy\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /speed-reading-formula-rendering\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /speed-reading-layout-integrity\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /FALLBACK_ASSET_VERSION = '2026-08-09-speed-reading-core-v1'/u);
  assert.match(workflow, /currentScriptAssetVersion/u);
  assert.match(workflow, /dataset\.readerEnhancement/u);
  assert.match(workflow, /inline_formula: 'paragraph'/u);
  assert.match(workflow, /table_title: 'caption'/u);
  assert.match(workflow, /BROAD_SEMANTIC_TYPES/u);
  assert.match(workflow, /preferCanonicalPdfVisualAssetRefs/u);
  assert.match(workflow, /SPEED_READING_EXCLUDED_PRESENTATION_KINDS/u);
  assert.match(workflow, /Chapter dividers are intentionally NOT excluded/u);
  assert.match(workflow, /sameLogicalTextSource/u);
  assert.match(workflow, /HARD_STRUCTURE_TYPES/u);
  assert.match(workflow, /refreshFrameTiming/u);
  assert.match(workflow, /LEADING_CLOSING_PUNCTUATION/u);
  assert.match(workflow, /Closing punctuation hangs on the current line/u);
  assert.ok(workflow.includes('&& [[ "${speed_layout}" != *"moveTrailingTokenToNextLine"* ]]'));
  assert.ok(workflow.includes('&& [[ "${punctuation_policy}" != *"CARRIED_CHARACTER_AND_PUNCTUATION"* ]]'));
  assert.match(workflow, /MIN_WIDTH_PERCENT = 20/u);
  assert.match(workflow, /splitMeasuredLineIntoBlocks/u);
  assert.match(workflow, /pageLineCapacity/u);
  assert.match(workflow, /displayMode: false/u);
  assert.match(workflow, /rendererChainReady/u);
  assert.match(workflow, /canonicalCaptionAssociations/u);
  assert.match(workflow, /same_page_spatial_visual_v1_frontend_fallback/u);
  assert.match(workflow, /CAPTION_VISUAL_MAX_VERTICAL_GAP = 0\.18/u);
  assert.match(workflow, /CAPTION_VISUAL_MIN_HORIZONTAL_OVERLAP = 0\.40/u);
  assert.match(workflow, /CAPTION_VISUAL_AMBIGUITY_MARGIN = 0\.025/u);
  assert.match(workflow, /sourceUnitIdForNode/u);
  assert.match(workflow, /normalizedSpatialAnchor/u);
  assert.match(workflow, /captionVisualMetrics/u);
  assert.match(workflow, /fallbackBoundVisualIds/u);
  assert.match(workflow, /unresolvedCaptionIds/u);
  assert.ok(workflow.includes('&& [[ "${layout_integrity}" != *"canonical_shared_parent_unique_visual"* ]]'));
  assert.ok(workflow.includes('&& [[ "${layout_integrity}" != *"canonical_visual_parent_unique_child"* ]]'));
  assert.match(workflow, /lineFrameCapacity/u);
  assert.match(workflow, /applySafeHorizontalInset/u);
  assert.match(workflow, /withPlaybackElementPolicy/u);
  assert.match(workflow, /GLYPH_BLEED_PX = 6/u);
  assert.match(workflow, /relaxTimedTextClipping/u);
});

test('Production lifecycle inherits the deployed entrypoint commit for every dynamically loaded enhancement', () => {
  const version = 'deadbeefcafefeed';
  const documentObject = fakeProductionDocument(version);
  assert.equal(Lifecycle.previewHeadVersion(documentObject), '');
  assert.equal(Lifecycle.currentScriptAssetVersion(documentObject), version);
  assert.equal(Lifecycle.assetVersion(documentObject), version);
  assert.equal(Lifecycle.versionedAsset('reader-fragment-join-policy.js', documentObject), `reader-fragment-join-policy.js?v=${version}`);
  assert.equal(Lifecycle.versionedAsset('speed-reading-v2.css', documentObject), `speed-reading-v2.css?v=${version}`);
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