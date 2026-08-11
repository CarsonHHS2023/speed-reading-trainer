const test = require('node:test');
const assert = require('node:assert/strict');

const PageRuntime = require('../speed-reading-page-runtime.js');

function makeRoot(capture) {
    class Controller {
        constructor(scope = 'page') {
            this.scope = scope;
            this.reader = {
                openResponse: { candidate_id: 'cand' },
                nodes: Array.from({ length: 300 }, (_, index) => ({ node_id: `visible-${index}` })),
                playbackBatchForCurrentPage: () => ({
                    start: 150,
                    firstNodeId: 'batch-0',
                    nodes: Array.from({ length: 150 }, (_, index) => ({ node_id: `batch-${index}` })),
                }),
            };
            this.activeBatchStart = null;
            this.document = {
                defaultView: {
                    getComputedStyle() {
                        return {
                            fontFamily: 'sans-serif',
                            fontSize: '28px',
                            fontStyle: 'normal',
                            fontWeight: '400',
                            lineHeight: '43.4px',
                        };
                    },
                },
            };
            this.frames = [];
            this.playback = {
                frames: [],
                setFrames: (frames) => {
                    this.playback.frames = frames;
                    this.frames = frames;
                },
                seek: (ratio, options) => {
                    capture.seek = { ratio, options };
                },
                play: () => {
                    capture.played = true;
                    return true;
                },
            };
            this.trainingClock = { stop() { capture.clockStopped = true; } };
        }

        displayScope() { return this.scope; }
        isReaderActive() { return true; }
        updateSettingsVisibility() {}
        applyVisualSettings() { capture.visualApplied = true; }
        adapterOptions() { return { maxWidthPx: 600, fontSizePx: 28, speedPerMinute: 600 }; }
        element(id) {
            if (id === 'pageText') return {};
            if (id === 'fontInput') return { value: '28' };
            return null;
        }
        playbackAvailableHeight() { return 400; }
        updateControls() { capture.controlsUpdated = true; }
        frameIndexForNode(nodeId, frames) { return frames.findIndex((frame) => frame.identity?.node_id === nodeId); }
        beginTrainingSession() { capture.trainingStarted = true; }
        stopTrainingTicker() { capture.tickerStopped = true; }
        refreshFrames() { capture.originalRefresh = true; return ['original-refresh']; }
        async start() { capture.originalStart = true; return 'original-start'; }
    }

    const layout = {
        DEFAULT_LINE_HEIGHT_RATIO: 1.55,
        createCanvasMeasurer() { return () => 10; },
        pageLineCapacity() { return 8; },
        pageHeightBudget() { return 400; },
        buildMeasuredPlaybackFrames(adapter, documentView, nodes, options) {
            capture.adapter = adapter;
            capture.documentView = documentView;
            capture.nodes = nodes;
            capture.options = options;
            return {
                frames: [
                    { kind: 'timed_text', identity: { node_id: 'before' }, lines: [] },
                    { kind: 'timed_text', identity: { node_id: 'batch-0' }, lines: [] },
                ],
            };
        },
    };
    const adapter = { name: 'adapter' };
    return {
        root: {
            ReaderSpeedPlaybackUI: { ReaderSpeedPlaybackUIController: Controller },
            SpeedReadingResponsiveLayout: layout,
            SpeedReadingAdapter: adapter,
        },
        Controller,
        layout,
        adapter,
    };
}

test('Page refresh builds measured frames from the current 150-node playback window, not both visible Reader windows', () => {
    const capture = {};
    const { root, Controller } = makeRoot(capture);
    assert.equal(PageRuntime.install(root), true);

    const controller = new Controller('page');
    const frames = controller.refreshFrames({ preserveIdentity: false });

    assert.equal(capture.nodes.length, 150);
    assert.equal(capture.nodes[0].node_id, 'batch-0');
    assert.equal(capture.nodes.at(-1).node_id, 'batch-149');
    assert.equal(capture.options.displayScope, 'page');
    assert.equal(capture.options.pageHeightPx, 400);
    assert.equal(frames.length, 2);
    assert.equal(controller.frames.length, 2);
    assert.equal(capture.originalRefresh, undefined);
});

test('Page start uses the measured Page refresh path and seeks to the current Reader page node', async () => {
    const capture = {};
    const { root, Controller } = makeRoot(capture);
    PageRuntime.install(root);

    const controller = new Controller('page');
    const started = await controller.start();

    assert.equal(started, true);
    assert.equal(controller.activeBatchStart, 150);
    assert.equal(capture.nodes.length, 150);
    assert.equal(capture.seek.ratio, 1 / 2);
    assert.deepEqual(capture.seek.options, { activate: false });
    assert.equal(capture.trainingStarted, true);
    assert.equal(capture.played, true);
    assert.equal(capture.originalStart, undefined);
});

test('Line and Block modes keep their existing consolidated runtime behavior', async () => {
    for (const scope of ['line', 'block']) {
        const capture = {};
        const { root, Controller } = makeRoot(capture);
        PageRuntime.install(root);
        const controller = new Controller(scope);

        assert.deepEqual(controller.refreshFrames(), ['original-refresh']);
        assert.equal(await controller.start(), 'original-start');
        assert.equal(capture.originalRefresh, true);
        assert.equal(capture.originalStart, true);
        assert.equal(capture.nodes, undefined);
    }
});
