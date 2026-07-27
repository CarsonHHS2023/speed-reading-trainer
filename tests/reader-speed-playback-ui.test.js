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
        style: { setProperty() {} },
        classList: classList(),
        dataset: {},
        listeners: [],
        children: [],
        firstChild: null,
        addEventListener(type, callback, options) { this.listeners.push({ type, callback, options }); },
        appendChild(child) { this.children.push(child); this.firstChild = this.children[0] || null; },
        prepend(child) { this.children.unshift(child); this.firstChild = this.children[0] || null; },
        removeChild(child) { this.children = this.children.filter((item) => item !== child); this.firstChild = this.children[0] || null; },
        setAttribute() {},
        closest() { return null; },
        querySelector() { return null; },
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
        ['fontInput', element('28')], ['fontSlider', element('28')], ['fontWeight', element('normal')],
    ]);
    const readingPanel = element();
    const documentListeners = [];
    return {
        body: { dataset: { readerV2Active: '1' } },
        head: { appendChild() {} },
        getElementById: (id) => elements.get(id) || null,
        createElement: () => element(),
        querySelector: (selector) => selector === '.reading-panel' ? readingPanel : null,
        addEventListener(type, callback) { documentListeners.push({ type, callback }); },
        documentListeners,
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
        pauseCalls: 0,
        resumeCalls: 0,
        manualContinueCalls: 0,
        setFrames(frames) { this.frames = [...frames]; },
        snapshot() { return { state: this.state, index: 0, frame: this.frames[0] || null, frame_count: this.frames.length }; },
        play() { this.playCalls += 1; this.state = 'playing'; return true; },
        stop() { this.state = 'idle'; },
        seek() {},
        pause() { this.pauseCalls += 1; this.state = 'paused'; return true; },
        resume() { this.resumeCalls += 1; this.state = 'playing'; return true; },
        continueManual() { this.manualContinueCalls += 1; return true; },
        previous() {},
        next() {},
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

test('reading-surface clicks do not pause playback; explicit playback controls own timing changes', () => {
    const documentObject = fakeDocument();
    documentObject.elements.set('speedReadingPause', element());
    const reader = fakeReader();
    const playback = fakePlayback();
    playback.frames = [{ frame_id: 'f1', kind: 'timed_text', identity: { node_id: 'n1' } }];
    const controller = new ReaderSpeedPlaybackUIController({
        documentObject,
        readerController: reader,
        playback,
        adapter: { buildPlaybackFrames: () => ({ frames: playback.frames }) },
    });
    controller.bind();

    const focusSurface = documentObject.elements.get('focusModeDisplay');
    const pageSurface = documentObject.elements.get('pageModeDisplay');
    assert.equal(focusSurface.listeners.some((listener) => listener.type === 'click'), false);
    assert.equal(pageSurface.listeners.some((listener) => listener.type === 'click'), false);

    playback.state = 'playing';
    const pauseButton = documentObject.elements.get('speedReadingPause');
    const pauseClick = pauseButton.listeners.find((listener) => listener.type === 'click').callback;
    pauseClick();
    assert.equal(playback.pauseCalls, 1);
    assert.equal(playback.state, 'paused');

    pauseClick();
    assert.equal(playback.resumeCalls, 1);
    assert.equal(playback.state, 'playing');
});

test('manual UX and new playback bridge contain no legacy content/blob/tokenizer/image-marker dependencies', () => {
    const source = fs.readFileSync(require.resolve('../reader-speed-playback-ui.js'), 'utf8');
    for (const forbidden of [
        'state.content', 'cachedContentBlob', 'tokenizeContent(', 'generatePages(', 'imageMarkerMap', '/api/v1/images/', '/api/v1/books/',
    ]) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
    assert.doesNotMatch(source, /focusModeDisplay', 'pageModeDisplay/);
    assert.match(source, /continueManual/);
    assert.match(source, /renderAssetInto/);
    assert.match(source, /stopImmediatePropagation/);
    assert.match(source, /SpeedReadingAdapter/);
});

test('manual playback styling is visually distinct and keeps Continue keyboard focus visible', () => {
    const css = fs.readFileSync(require.resolve('../speed-reading-v2.css'), 'utf8');
    assert.match(css, /\.reader-playback-asset-slot/);
    assert.match(css, /\.reader-playback-continue:focus-visible/);
    assert.doesNotMatch(css, /#focusModeDisplay\.active,\s*#pageModeDisplay\.active\s*\{\s*cursor:\s*pointer/);
});

test('index loads deterministic adapter and playback bridge before legacy app script', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const adapter = html.indexOf('speed-reading-adapter.js');
    const controller = html.indexOf('playback-controller.js');
    const bridge = html.indexOf('reader-speed-playback-ui.js');
    const app = html.indexOf('app.js');
    assert.ok(adapter >= 0 && controller > adapter && bridge > controller && app > bridge);
});