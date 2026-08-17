const test = require('node:test');
const assert = require('node:assert/strict');

const Layout = require('../speed-reading-responsive-layout.js');
const BlockPolicy = require('../speed-reading-block-layout-policy.js');

function movingOverflowBuild() {
    function frame(id, gap, lineIndex, yPx) {
        return {
            frame_id: `frame-${id}`,
            kind: 'timed_text',
            text: id,
            lines: [{
                text: id,
                node_type: 'paragraph',
                identity: { node_id: id },
                source_spans: [{ node_id: id }],
                paragraph_gap_before_px: gap,
                row_height_px: 31,
            }],
            placement: {
                display_scope: 'block',
                virtual_page_index: 0,
                line_index: lineIndex,
                y_px: yPx,
                width_px: 40,
            },
        };
    }
    return {
        frames: [frame('p1', 0, 0, 0), frame('p2', 9, 1, 40)],
        options: {
            displayScope: 'block',
            readingMode: 'moving',
            lineHeightPx: 31,
            fontSizePx: 20,
            pageLineCapacity: 2,
            pageHeightPx: 62,
        },
    };
}

function runtimeFixture() {
    let exportedBuildCalls = 0;
    const responsive = {
        buildMeasuredPlaybackFrames() {
            exportedBuildCalls += 1;
            return { frames: [], options: {} };
        },
        measuredRowMetrics: Layout.measuredRowMetrics,
    };

    class FakeController {
        constructor(scope = 'block', mode = 'moving') {
            this.scope = scope;
            this.mode = mode;
        }
    }
    FakeController.prototype.__speedReadingLayoutIntegrityInstalled = true;
    FakeController.prototype.buildFrames = function buildFrames() { return movingOverflowBuild(); };
    FakeController.prototype.adapterOptions = function adapterOptions() {
        return { displayScope: this.scope, readingMode: this.mode };
    };
    FakeController.prototype.displayScope = function displayScope() { return this.scope; };
    FakeController.prototype.readingMode = function readingMode() { return this.mode; };
    FakeController.prototype.playbackContext = function playbackContext() { return { nodes: [] }; };
    FakeController.prototype.onDisplayModeChanged = function onDisplayModeChanged() { return true; };
    FakeController.prototype.onSettingChanged = function onSettingChanged() { return true; };
    FakeController.prototype.updateSettingsVisibility = function updateSettingsVisibility() {};
    FakeController.prototype.applyVisualSettings = function applyVisualSettings() {};
    FakeController.prototype.isReaderActive = function isReaderActive() { return true; };

    return {
        root: {
            SpeedReadingResponsiveLayout: responsive,
            ReaderSpeedPlaybackUI: {
                ReaderSpeedPlaybackUIController: FakeController,
                getDefaultController: () => null,
            },
        },
        responsive,
        FakeController,
        exportedBuildCalls: () => exportedBuildCalls,
    };
}

test('installed Block policy reflows the Controller build result even when the exported measured builder is not called', () => {
    const fixture = runtimeFixture();
    assert.equal(BlockPolicy.install(fixture.root), true);

    const controller = new fixture.FakeController('block', 'moving');
    const built = controller.buildFrames({ nodes: [] });

    assert.equal(fixture.exportedBuildCalls(), 0);
    assert.equal(controller.__blockViewpointRuntimeBuildWrapped, true);
    assert.equal(built.options.movingBlockVerticalReflow, true);
    assert.deepEqual(
        built.frames.map((frame) => [frame.placement.virtual_page_index, frame.placement.y_px]),
        [[0, 0], [1, 0]],
    );
    for (const frame of built.frames) {
        const bottom = frame.placement.y_px + BlockPolicy.blockRowHeightPx(frame, built, fixture.responsive);
        assert.ok(bottom <= built.options.pageHeightPx + 0.01);
    }
});

test('runtime Block decorator leaves Line mode and fixed-viewpoint Block geometry unchanged', () => {
    const fixture = runtimeFixture();
    assert.equal(BlockPolicy.install(fixture.root), true);

    const lineBuilt = new fixture.FakeController('line', 'moving').buildFrames({ nodes: [] });
    assert.equal(lineBuilt.options.movingBlockVerticalReflow, undefined);
    assert.equal(lineBuilt.frames[1].placement.y_px, 40);

    const fixedBuilt = new fixture.FakeController('block', 'focus').buildFrames({ nodes: [] });
    assert.equal(fixedBuilt.options.movingBlockVerticalReflow, undefined);
    assert.equal(fixedBuilt.frames[1].placement.y_px, 40);
});
