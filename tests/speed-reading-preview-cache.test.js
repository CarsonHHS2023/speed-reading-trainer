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

test('Preview bootstraps speed-reading enhancements from the exact deployed head through one lifecycle owner', () => {
  const head = 'abc123previewhead';
  const documentObject = fakePreviewDocument(head);
  assert.equal(Lifecycle.previewHeadVersion(documentObject), head);
  assert.equal(Lifecycle.assetVersion(documentObject), head);
  assert.equal(Lifecycle.versionedAsset('speed-reading-structure-policy.js', documentObject), `speed-reading-structure-policy.js?v=${head}`);
  assert.equal(Lifecycle.versionedAsset('speed-reading-responsive-layout.js', documentObject), `speed-reading-responsive-layout.js?v=${head}`);

  const clock = fs.readFileSync('training-session-clock.js', 'utf8');
  const lifecycleSource = fs.readFileSync('reader-resume-lifecycle.js', 'utf8');
  const workflow = fs.readFileSync('.github/workflows/preview.yml', 'utf8');

  assert.match(clock, /ReaderTrainingSessionClock/u);
  assert.doesNotMatch(clock, /speed-reading-responsive-layout\.js/u);
  assert.doesNotMatch(clock, /data-reader-enhancement/u);

  assert.match(lifecycleSource, /meta\[name="reader-preview-head"\]/u);
  assert.match(lifecycleSource, /function currentScriptAssetVersion\(documentObject/u);
  assert.match(lifecycleSource, /const ENTRYPOINT_ASSET_VERSION = currentScriptAssetVersion/u);
  assert.match(lifecycleSource, /\|\| ENTRYPOINT_ASSET_VERSION/u);
  assert.match(lifecycleSource, /function versionedAsset\(src, documentObject/u);
  assert.match(lifecycleSource, /script\.src = versionedAsset\(src\)/u);
  assert.match(lifecycleSource, /script\.dataset\.readerEnhancement = src/u);
  assert.match(lifecycleSource, /script\.dataset\.loaded = '1'/u);
  for (const asset of [
    'speed-reading-structure-policy.js',
    'reader-fragment-join-policy.js',
    'speed-reading-responsive-layout.js',
    'reader-punctuation-hanging-policy.js',
    'speed-reading-formula-rendering.js',
    'speed-reading-layout-integrity.js',
    'speed-reading-block-layout-policy.js',
    'speed-reading-speed-policy.js',
    'reader-playback-polish.js',
    'reader-study-tools-rail.js',
  ]) {
    assert.ok(lifecycleSource.includes(asset), `canonical lifecycle loads ${asset}`);
  }

  assert.match(workflow, /"training-session-clock\.js"/u);
  assert.match(workflow, /"reader-resume-lifecycle\.js"/u);
  assert.match(workflow, /training-session-clock\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /reader-resume-lifecycle\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /training_clock.*ReaderTrainingSessionClock/u);
  assert.match(workflow, /training_clock.*!=.*speed-reading-responsive-layout\.js/u);
  assert.match(workflow, /lifecycle.*ENTRYPOINT_ASSET_VERSION/u);
  assert.match(workflow, /lifecycle.*script\.dataset\.readerEnhancement = src/u);
  assert.match(workflow, /lifecycle.*speed-reading-block-layout-policy\.js/u);
  assert.match(workflow, /lifecycle.*speed-reading-speed-policy\.js/u);
  assert.match(workflow, /speed_layout.*isClosingPunctuationToken\(token\)/u);
  assert.ok(workflow.includes('&& [[ "${speed_layout}" != *"moveTrailingTokenToNextLine"* ]]'));
  assert.ok(workflow.includes('&& [[ "${punctuation_policy}" != *"CARRIED_CHARACTER_AND_PUNCTUATION"* ]]'));
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