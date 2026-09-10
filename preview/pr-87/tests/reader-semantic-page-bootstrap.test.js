const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('reader-presentation.js', 'utf8');

test('browser bootstrap loads semantic page CSS and renderer assets', () => {
  assert.match(source, /ensureStylesheet\('reader-semantic-page\.css'\)/);
  assert.match(source, /loadScriptOnce\('reader-semantic-page\.js'/);
  assert.match(source, /reader-semantic-page-integration\.js/);
});

test('browser bootstrap waits for Reader UI before installing integration', () => {
  const waitIndex = source.indexOf('waitForReady(() => Boolean(root.ReaderUIV2?.ReaderV2Controller))');
  const integrationIndex = source.indexOf("'reader-semantic-page-integration.js'");
  const installIndex = source.indexOf('installSemanticPageIntegration()');
  assert.ok(waitIndex >= 0);
  assert.ok(integrationIndex > waitIndex);
  assert.ok(installIndex > integrationIndex);
});

test('browser bootstrap keeps legacy rendering as fallback on asset failure', () => {
  assert.match(source, /Semantic full-page Reader bootstrap failed/);
  assert.match(source, /if \(!root \|\| typeof document === 'undefined'\) return/);
});
