const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ReaderSpeedPlaybackUIController } = require('../reader-speed-playback-ui.js');

function element(value = '') {
    return {
        value,
        dataset: {},
        style: { setProperty() {} },
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        appendChild() {},
        querySelector() { return null; },
        closest() { return null; },
    };
}

function makeDocument(values = {}) {
    const map = new Map(Object.entries(values).map(([id, value]) => [id, element(value)]));
    return {
        body: { dataset: { readerV2Active: '1' } },
        head: { appendChild() {} },
        getElementById(id) { return map.get(id) || null; },
        querySelector(selector) {
            if (selector === '.reading-panel') return element();
            return null;
        },
        createElement(tag) {
            const el = element();
            el.tagName = String(tag).toUpperCase();
            el.children = [];
            el.appendChild = (child) => el.children.push(child);
            el.prepend = (child) => el.children.unshift(child);
            el.setAttribute = () => {};
            return el;
        },
        addEventListener() {},
    };
}

function makeReader() {
    return {
        openResponse: {
            contract_version: '2',
            document_ref: 'doc-1',
            candidate_id: 'cand-1',
            candidate_schema_id: 'atlas.structured-content-candidate',
            candidate_schema_version: 2,
        },
        nodes: [{ node_id: 'n1', node_type: 'paragraph', order: 0, text: 'hello world' }],
        hasMore: false,
        persistLocation() {},
    };
}

test('adapter options expose block, line, and page scopes independently from reading mode', () => {
    const doc = makeDocument({ displayMode: 'block', trainingMode: 'moving', widthInput: '40', linesInput: '4', maxLinesInput: '22', speedInput: '900' });
    const controller = new ReaderSpeedPlaybackUIController({ documentObject: doc, readerController: makeReader() });
    assert.equal(controller.displayScope(), 'block');
    assert.equal(controller.readingMode(), 'moving');
    assert.deepEqual(controller.adapterOptions(), {
        displayScope: 'block',
        lineWidth: 40,
        maxLines: 4,
        speedPerMinute: 900,
    });
    doc.getElementById('displayMode').value = 'page';
    assert.equal(controller.adapterOptions().displayScope, 'page');
    assert.equal(controller.adapterOptions().maxLines, 22);
});

test('keyboard controls map only to semantic playback actions and ignore editable targets', () => {
    const doc = makeDocument();
    const reader = makeReader();
    const controller = new ReaderSpeedPlaybackUIController({ documentObject: doc, readerController: reader });
    const calls = [];
    controller.playback.frames = [{ frame_id: 'f1' }, { frame_id: 'f2' }];
    controller.playback.state = 'paused';
    controller.trainingClock.state = 'running';
    controller.previousFrame = () => calls.push('previous');
    controller.nextFrame = () => calls.push('next');
    controller.togglePause = () => calls.push('pause');
    controller.stop = () => calls.push('stop');
    const event = (props) => ({ preventDefault() { calls.push('prevent'); }, target: { tagName: 'DIV' }, ...props });
    controller.onKeyDown(event({ key: 'ArrowLeft' }));
    controller.onKeyDown(event({ key: 'ArrowRight' }));
    controller.onKeyDown(event({ code: 'Space' }));
    controller.onKeyDown(event({ key: 'Escape' }));
    assert.deepEqual(calls.filter((item) => item !== 'prevent'), ['previous', 'next', 'pause', 'stop']);
    const before = calls.length;
    controller.onKeyDown({ key: 'ArrowRight', target: { tagName: 'INPUT' }, preventDefault() { calls.push('prevent'); } });
    assert.equal(calls.length, before);
});

test('Speed Reading UX source preserves Reader v2-only content boundaries', () => {
    const source = fs.readFileSync(require.resolve('../reader-speed-playback-ui.js'), 'utf8');
    for (const required of ['displayScope', 'readingMode', 'previousFrame', 'nextFrame', 'onKeyDown', 'persistResume', 'speed-reading-v2.css']) {
        assert.equal(source.includes(required), true, required);
    }
    for (const forbidden of ['/api/reader/v1', '/api/v1/books/', 'cachedContentBlob', 'state.content', 'tokenizeContent(', 'imageMarkerMap', 'page_id', 'presentation_id', 'Study Assistant', '/api/study/v1/ask']) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
});

test('Speed Reading stylesheet provides distinct focus and moving presentation without canonical position state', () => {
    const source = fs.readFileSync(require.resolve('../speed-reading-v2.css'), 'utf8');
    assert.match(source, /data-speed-reading-mode="focus"/);
    assert.match(source, /data-speed-reading-mode="moving"/);
    assert.match(source, /speed-reading-v2-toolbar/);
    for (const forbidden of ['page_id', 'presentation_id', 'scroll_offset', 'token_index']) {
        assert.equal(source.includes(forbidden), false, forbidden);
    }
});
