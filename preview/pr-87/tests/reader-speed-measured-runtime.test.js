const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const playbackSource = fs.readFileSync(require.resolve('../reader-speed-playback-ui.js'), 'utf8');
const responsiveSource = fs.readFileSync(require.resolve('../speed-reading-responsive-layout.js'), 'utf8');

test('speed start uses the authoritative refresh/build pipeline instead of bypassing measured layout', () => {
    const startMatch = playbackSource.match(/async start\(\) \{([\s\S]*?)\n        \}\n\n        stop\(\)/u);
    assert.ok(startMatch, 'start() implementation should be discoverable');
    assert.match(startMatch[1], /this\.refreshFrames\(\{ preserveIdentity: false, context \}\)/u);
    assert.doesNotMatch(startMatch[1], /this\.adapter\.buildPlaybackFrames/u);
});

test('responsive layout decorates frame construction without replacing refresh ownership', () => {
    assert.match(responsiveSource, /Controller\.prototype\.buildFrames = function responsiveBuildFrames/u);
    assert.match(responsiveSource, /buildMeasuredPlaybackFrames\(adapter, this\.reader\.openResponse, context\.nodes,/u);
    assert.doesNotMatch(responsiveSource, /Controller\.prototype\.refreshFrames = function responsiveRefreshFrames/u);
    assert.doesNotMatch(responsiveSource, /buildMeasuredPlaybackFrames\(adapter, this\.reader\.openResponse, this\.reader\.nodes/u);
});

test('core refresh passes one explicit playback context into the active frame builder', () => {
    const refreshMatch = playbackSource.match(/refreshFrames\(options = \{\}\) \{([\s\S]*?)\n        \}\n\n        persistResume/u);
    assert.ok(refreshMatch, 'refreshFrames() implementation should be discoverable');
    assert.match(refreshMatch[1], /const context = options\.context \|\| this\.playbackContext\(\)/u);
    assert.match(refreshMatch[1], /const built = this\.buildFrames\(context\)/u);
});
