const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const readerCss = fs.readFileSync(require.resolve('../reader-v2.css'), 'utf8');
const playbackSource = fs.readFileSync(require.resolve('../reader-speed-playback-ui.js'), 'utf8');

test('Reader v2 display guard respects playback active classes', () => {
    assert.doesNotMatch(
        readerCss,
        /body\[data-reader-v2-active="1"\] #readerV2Display \{ display: flex; \}/,
    );
    assert.match(
        readerCss,
        /body\[data-reader-v2-active="1"\] #readerV2Display\.active \{ display: flex; \}/,
    );
    assert.match(
        readerCss,
        /body\[data-reader-v2-active="1"\] #readerV2Display:not\(\.active\) \{ display: none; \}/,
    );
    assert.match(
        readerCss,
        /body\[data-reader-v2-active="1"\] #focusModeDisplay\.active,[\s\S]*#pageModeDisplay\.active \{ display: flex !important; \}/,
    );
});

test('playback bridge owns the active-class surface handoff', () => {
    assert.match(playbackSource, /reader\.classList\.remove\('active'\)/);
    assert.match(playbackSource, /focus\.classList\.toggle\('active', !usePage\)/);
    assert.match(playbackSource, /page\.classList\.toggle\('active', usePage\)/);
    assert.match(playbackSource, /reader\.classList\.add\('active'\)/);
});
