const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ReaderSpeedPlaybackUIController } = require('../reader-speed-playback-ui.js');

function classList() {
    const values = new Set();
    return {
        add: (...items) => items.forEach((item) => values.add(item)),
        remove: (...items) => items.forEach((item) => values.delete(item)),
        toggle: (item, force) => {
            if (force === true) values.add(item);
            else if (force === false) values.delete(item);
            else if (values.has(item)) values.delete(item);
            else values.add(item);
        },
        contains: (item) => values.has(item),
    };
}

function element(value = '') {
    return {
        value,
        max: '1000',
        disabled: true,
        textContent: '',
        title: '',
        classList: classList(),
        dataset: {},
        listeners: [],
        children: [],
        firstChild: null,
        addEventListener(type, callback, options) { this.listeners.push({ type, callback, options }); },
        appendChild(child) { this.children.push(child); this.firstChild = this.children[0] || null; },
        removeChild(child) { this.children = this.children.filter((item) => item !== child); this.firstChild = this.children[0] || null; },
    };
}

function fakeDocument() {
    const elements = new Map([
        ['readingToggleBtn', element()], ['currentPos', element()], ['totalWords', element()],
        ['progressSlider', element('0')], ['displayMode', element('focus')], ['speedInput', element('600')],
        ['speedSlider', element('600')], ['widthInput', element('10')], ['widthSlider', element('10')],
        ['linesInput', element('2')], ['linesSlider', element('2')], ['maxLinesInput', element('5')],
        ['maxLinesSlider', element('5')], ['focusModeDisplay', element()], ['pageModeDisplay', element()],
        ['focusText', element()], ['pageText', element()], ['readerV2Display', element()], ['chartDisplay', element()],
    ]);
    return {
        body: { dataset: { readerV2Active: '1' } },
        getElementById: (id) => elements.get(id) || null,
        createElement: () => element(),
        elements,
    };
}

function fakeReader() {
    return {
        openResponse: { contract_version: '2', document_ref: 'doc', candidate_id: 'cand', candidate_schema_id: 'schema', candidate_schema_version: 2 },
        nodes: [{ node_id: 'n1', order: 0, node_type: 'paragraph', text: 'hello', source_unit_ids: ['su1'] }],
        hasMore: true,
        loadCalls: 0,
        async loadMore() { this.loadCalls += 1; this.hasMore = false; return {}; },
        setStatus() {},
        renderError() {},
    };
}

function fakePlayback() {
    return {
        state: 'idle',
        frames: [],
        playCalls: 0,
        setFrames(frames) { this.frames = [...frames]; },
        snapshot() { return { state: this.state, index: 0, frame: this.frames[0] || null, frame_count: this.frames.length }; },
        play() { this.playCalls += 1; this.state = 'playing'; return true; },
        stop() { this.state = 'idle'; },
        seek() {},
        pause() { this.state = 'paused'; },
        resume() { this.state = 'playing'; },
        continueManual() {},
    };
}

test('Reader v2 playback start loads remaining nodes, builds frames, and enables play control', async () => {
    const documentObject = fakeDocument();
    const reader = fakeReader();
    const playback = fakePlayback();
    const adapter = {
        buildPlaybackFrames(view, nodes, options) {
            assert.equal(view.candidate_id, 'cand');
            assert.equal(nodes[0].node_id, 'n1');
            assert.equal(options.displayScope, 'line');
            return { frames: [{ frame_id: 'f1', kind: 'timed_text', text: 'hello', identity: { candidate_id: 'cand', node_id: 'n1' } }] };
        },
    };
    const controller = new ReaderSpeedPlaybackUIController({ documentObject, readerController: reader, playback, adapter });
    controller.refreshFrames({ preserveIdentity: false });
    assert.equal(documentObject.elements.get('readingToggleBtn').disabled, false);
    const started = await controller.start();
    assert.equal(started, true);
    assert.equal(reader.loadCalls, 1);
    assert.equal(playback.playCalls, 1);
});

test('new playback bridge contains no legacy content/blob/tokenizer/image-marker dependencies', () => {
    const source = fs.readFileSync(require.resolve('../reader-speed-playback-ui.js'), 'utf8');
    for (const forbidden of [
        'state.content', 'cachedContentBlob', 'tokenizeContent(', 'generatePages(', 'imageMarkerMap', '/api/v1/images/', '/api/v1/books/',
    ]) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
    assert.match(source, /stopImmediatePropagation/);
    assert.match(source, /SpeedReadingAdapter/);
});

test('index loads deterministic adapter and playback bridge before legacy app script', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const adapter = html.indexOf('speed-reading-adapter.js');
    const controller = html.indexOf('playback-controller.js');
    const bridge = html.indexOf('reader-speed-playback-ui.js');
    const app = html.indexOf('app.js');
    assert.ok(adapter >= 0 && controller > adapter && bridge > controller && app > bridge);
});