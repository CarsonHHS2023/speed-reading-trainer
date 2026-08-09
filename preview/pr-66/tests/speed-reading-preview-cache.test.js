const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('Preview bootstraps the speed-reading layout from the exact deployed head', () => {
  const clock = fs.readFileSync('training-session-clock.js', 'utf8');
  const workflow = fs.readFileSync('.github/workflows/preview.yml', 'utf8');

  assert.match(clock, /meta\[name="reader-preview-head"\]/u);
  assert.match(clock, /speed-reading-responsive-layout\.js\?v=\$\{encodeURIComponent\(previewHead\)\}/u);
  assert.match(workflow, /"training-session-clock\.js"/u);
  assert.match(workflow, /training-session-clock\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /speed-reading-responsive-layout\.js\?v=\$\{PREVIEW_HEAD_SHA\}/u);
  assert.match(workflow, /MIN_WIDTH_PERCENT = 20/u);
  assert.match(workflow, /splitMeasuredLineIntoBlocks/u);
  assert.match(workflow, /pageLineCapacity/u);
});
