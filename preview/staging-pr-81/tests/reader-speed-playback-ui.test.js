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
        ['readingToggleBtn', element()], ['currentPos', element()], ['totalWords', element()], ['readingTime', element()],
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
    const reader = {
        openResponse: { contract_version: '2', document_ref: 'doc', candidate_id: 'cand', candidate_schema_id: 'schema', candidate_schema_version: 2 },
        nodes: [{ node_id: 'n1', order: 0, node_type: 'paragraph', text: 'hello', source_unit_ids: ['su1'] }],
        hasMore: true,
        loadCalls: 0,
        async loadMore() { this.loadCalls += 1; this.hasMore = false; return {}; },
        playbackBatchForCurrentPage() {
            return { start: 0, nodes: this.nodes, firstNodeId: 'n1' };
        },
        windowRecord(start) {
            return start === 0 ? { start: 0, nodes: this.nodes } : null;
        },
        pageNavigationState() {
            return { readable: true, pending: false, atDocumentStart: true, atDocumentEnd: false };
        },
        async previousPage() { return true; },
        async nextPage() { return true; },
        async firstPage() { return true; },
        async lastPage() { return true; },
        persistLocation() {},
        setStatus() {},
        renderError() {},
    };
    return reader;
}

function fakePlayback() {
    return {
        state: 'idle',
        frames: [],
        index: 0,
        playCalls: 0,
        pauseCalls: 0,
        resumeCalls: 0,
        manualContinueCalls: 0,
        setFrames(frames) { this.frames = [...frames]; this.index = 0; this.state = this.frames.length ? 'idle' : 'idle'; },
        snapshot() { return { state: this.state, index: this.index, frame: this.frames[this.index] || null, frame_count: this.frames.length }; },
        currentFrame() { return this.frames[this.index] || null; },
        play() { this.playCalls += 1; if (!this.frames.length) return false; this.state = 'playing'; return true; },
        stop() { this.state = 'idle'; this.index = 0; },
        seek(progress, options = {}) {
            if (!this.frames.length) return null;
            this.index = Math.min(this.frames.length - 1, Math.floor(Number(progress || 0) * this.frames.length));
            if (options.activate === false) this.state = 'idle';
            return this.currentFrame();
        },
        pause() { this.pauseCalls += 1; this.state = 'paused'; return true; },
        resume() { this.resumeCalls += 1; this.state = 'playing'; return true; },
        continueManual() { this.manualContinueCalls += 1; return true; },
        moveBy(delta) {
            this.index = Math.max(0, Math.min(this.frames.length - 1, this.index + Number(delta || 0)));
            this.state = 'paused';
            return this.currentFrame();
        },
        previous() { return this.moveBy(-1); },
        next() { return this.moveBy(1); },
    };
}

function fakeTrainingClock() {
    return {
        state: 'idle',
        elapsed: 0,
        startCalls: 0,
        pauseCalls: 0,
        resumeCalls: 0,
        stopCalls: 0,
        start() { this.startCalls += 1; this.elapsed = 0; this.state = 'running'; },
        pause() { if (this.state !== 'running') return false; this.pauseCalls += 1; this.state = 'paused'; return true; },
        resume() { if (this.state !== 'paused') return false; this.resumeCalls += 1; this.state = 'running'; return true; },
        stop() { this.stopCalls += 1; this.state = 'stopped'; return this.elapsed; },
        elapsedMs() { return this.elapsed; },
    };
}

function clickListener(target) {
    return target.listeners.find((listener) => listener.type === 'click')?.callback;
}

function clickEvent() {
    return { preventDefault() {}, stopImmediatePropagation() {}, stopPropagation() {} };
}

test('Reader v2 playback starts from the current Reader batch without loading additional content', async () => {
    const documentObject = fakeDocument();
    const reader = fakeReader();
    const playback = fakePlayback();
    const trainingClock = fakeTrainingClock();
    const adapter = {
        buildPlaybackFrames(view, nodes, options) {
            assert.equal(view.candidate_id, 'cand');
            assert.equal(nodes[0].node_id, 'n1');
            assert.equal(options.displayScope, 'line');
            return { frames: [{ frame_id: 'f1', kind: 'timed_text', text: 'hello', identity: { candidate_id: 'cand', node_id: 'n1' } }] };
        },
    };
    const controller = new ReaderSpeedPlaybackUIController({ documentObject, readerController: reader, playback, adapter, trainingClock });
    controller.updateControls();
    assert.equal(documentObject.elements.get('readingToggleBtn').disabled, false);
    const started = await controller.start();
    assert.equal(started, true);
    assert.equal(reader.loadCalls, 0);
    assert.equal(playback.playCalls, 1);
    assert.equal(trainingClock.startCalls, 1);
    assert.equal(trainingClock.state, 'running');
});

test('reading-area click pauses only auto-play while training time keeps running, then resumes auto-play', () => {
    const documentObject = fakeDocument();
    const reader = fakeReader();
    const playback = fakePlayback();
    const trainingClock = fakeTrainingClock();
    trainingClock.state = 'running';
    playback.frames = [{ frame_id: 'f1', kind: 'timed_text', identity: { node_id: 'n1' } }];
    playback.state = 'playing';
    const controller = new ReaderSpeedPlaybackUIController({ documentObject, readerController: reader, playback, trainingClock });
    controller.bind();

    const focusSurface = documentObject.elements.get('focusModeDisplay');
    const pageSurface = documentObject.elements.get('pageModeDisplay');
    assert.ok(clickListener(focusSurface));
    assert.ok(clickListener(pageSurface));

    clickListener(focusSurface)(clickEvent());
    assert.equal(playback.pauseCalls, 1);
    assert.equal(playback.state, 'paused');
    assert.equal(controller.comprehensionPaused, true);
    assert.equal(trainingClock.pauseCalls, 0);
    assert.equal(trainingClock.state, 'running');

    trainingClock.elapsed = 4200;
    controller.updateTrainingTime();
    assert.equal(documentObject.elements.get('readingTime').textContent, '00:04');

    clickListener(focusSurface)(clickEvent());
    assert.equal(playback.resumeCalls, 1);
    assert.equal(playback.state, 'playing');
    assert.equal(controller.comprehensionPaused, false);
    assert.equal(trainingClock.resumeCalls, 0);
    assert.equal(trainingClock.state, 'running');
});

test('playback UI Pause/Resume pauses and resumes both auto-play and training clock', () => {
    const documentObject = fakeDocument();
    documentObject.elements.set('speedReadingPause', element());
    const reader = fakeReader();
    const playback = fakePlayback();
    const trainingClock = fakeTrainingClock();
    trainingClock.state = 'running';
    playback.frames = [{ frame_id: 'f1', kind: 'timed_text', identity: { node_id: 'n1' } }];
    playback.state = 'playing';
    const controller = new ReaderSpeedPlaybackUIController({ documentObject, readerController: reader, playback, trainingClock });
    controller.bind();

    const pauseClick = clickListener(documentObject.elements.get('speedReadingPause'));
    pauseClick();
    assert.equal(playback.pauseCalls, 1);
    assert.equal(playback.state, 'paused');
    assert.equal(trainingClock.pauseCalls, 1);
    assert.equal(trainingClock.state, 'paused');
    assert.equal(controller.trainingPaused, true);

    pauseClick();
    assert.equal(playback.resumeCalls, 1);
    assert.equal(playback.state, 'playing');
    assert.equal(trainingClock.resumeCalls, 1);
    assert.equal(trainingClock.state, 'running');
    assert.equal(controller.trainingPaused, false);
});

test('UI training pause during comprehension preserves comprehension pause after training resumes', () => {
    const documentObject = fakeDocument();
    documentObject.elements.set('speedReadingPause', element());
    const reader = fakeReader();
    const playback = fakePlayback();
    const trainingClock = fakeTrainingClock();
    trainingClock.state = 'running';
    playback.frames = [{ frame_id: 'f1', kind: 'timed_text', identity: { node_id: 'n1' } }];
    playback.state = 'playing';
    const controller = new ReaderSpeedPlaybackUIController({ documentObject, readerController: reader, playback, trainingClock });
    controller.bind();

    clickListener(documentObject.elements.get('focusModeDisplay'))(clickEvent());
    assert.equal(controller.comprehensionPaused, true);
    assert.equal(playback.state, 'paused');

    const pauseClick = clickListener(documentObject.elements.get('speedReadingPause'));
    pauseClick();
    assert.equal(trainingClock.state, 'paused');
    pauseClick();
    assert.equal(trainingClock.state, 'running');
    assert.equal(playback.state, 'paused');
    assert.equal(controller.comprehensionPaused, true);

    clickListener(documentObject.elements.get('focusModeDisplay'))(clickEvent());
    assert.equal(playback.state, 'playing');
});

test('manual frames keep training time running; UI pause controls training clock without advancing manual content', () => {
    const documentObject = fakeDocument();
    documentObject.elements.set('speedReadingPause', element());
    const reader = fakeReader();
    const playback = fakePlayback();
    const trainingClock = fakeTrainingClock();
    trainingClock.state = 'running';
    playback.frames = [{ frame_id: 'm1', kind: 'manual', identity: { node_id: 'figure-1' } }];
    playback.state = 'manual';
    const controller = new ReaderSpeedPlaybackUIController({ documentObject, readerController: reader, playback, trainingClock });
    controller.bind();

    assert.equal(trainingClock.state, 'running');
    assert.equal(controller.continueManual(), true);
    assert.equal(playback.manualContinueCalls, 1);

    playback.state = 'manual';
    clickListener(documentObject.elements.get('speedReadingPause'))();
    assert.equal(trainingClock.state, 'paused');
    assert.equal(playback.state, 'manual');
    assert.equal(controller.continueManual(), false);
    assert.equal(playback.manualContinueCalls, 1);

    clickListener(documentObject.elements.get('speedReadingPause'))();
    assert.equal(trainingClock.state, 'running');
    assert.equal(playback.state, 'manual');
});

test('manual UX and playback bridge contain no legacy content/blob/tokenizer/image-marker dependencies', () => {
    const source = fs.readFileSync(require.resolve('../reader-speed-playback-ui.js'), 'utf8');
    for (const forbidden of [
        'state.content', 'cachedContentBlob', 'tokenizeContent(', 'generatePages(', 'imageMarkerMap', '/api/v1/images/', '/api/v1/books/',
    ]) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
    assert.match(source, /toggleComprehensionPause/);
    assert.match(source, /toggleTrainingPause/);
    assert.match(source, /ReaderTrainingSessionClock/);
    assert.match(source, /continueManual/);
    assert.match(source, /renderAssetInto/);
    assert.match(source, /stopImmediatePropagation/);
    assert.match(source, /SpeedReadingAdapter/);
});

test('manual playback styling is visually distinct and keeps Continue keyboard focus visible', () => {
    const css = fs.readFileSync(require.resolve('../speed-reading-v2.css'), 'utf8');
    assert.match(css, /\.reader-playback-asset-slot/);
    assert.match(css, /\.reader-playback-continue:focus-visible/);
});

test('index loads playback controller, training clock, and bridge before legacy app script', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const adapter = html.indexOf('speed-reading-adapter.js');
    const controller = html.indexOf('playback-controller.js');
    const clock = html.indexOf('training-session-clock.js');
    const bridge = html.indexOf('reader-speed-playback-ui.js');
    const app = html.indexOf('app.js');
    assert.ok(adapter >= 0 && controller > adapter && clock > controller && bridge > clock && app > bridge);
});