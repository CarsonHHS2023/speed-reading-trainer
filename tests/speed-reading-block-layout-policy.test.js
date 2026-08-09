const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Adapter = require('../speed-reading-adapter.js');
const StructurePolicy = require('../speed-reading-structure-policy.js');
const Layout = require('../speed-reading-responsive-layout.js');
const Policy = require('../speed-reading-block-layout-policy.js');

const documentView = {
    contract_version: '2',
    document_ref: 'doc-block-viewpoint',
    candidate_id: 'cand-block-viewpoint',
    candidate_schema_id: 'atlas.structured-content-v2',
    candidate_schema_version: 2,
    source_units: [{ source_unit_id: 'su-1', source_order: 0, kind: 'text_flow' }],
};

function node(id, order, type, text) {
    return {
        node_id: id,
        order,
        node_type: type,
        text,
        source_unit_ids: ['su-1'],
        location: {
            node_id: id,
            source_unit_id: 'su-1',
            source_anchor: { kind: 'text_span', start: order * 100, end: order * 100 + String(text || '').length },
        },
    };
}

function tenPxMeasure(text) {
    return Array.from(String(text || '')).length * 10;
}

function build(nodes, options = {}) {
    return Policy.buildBlockAwarePlaybackFrames(
        Layout.buildMeasuredPlaybackFrames,
        Layout,
        Adapter,
        documentView,
        nodes,
        {
            displayScope: 'block',
            readingMode: 'focus',
            widthPercent: 30,
            maxWidthPx: 100,
            lineCount: 1,
            pageLineCapacity: 20,
            lineHeightPx: 20,
            speedPerMinute: 600,
            measureText: tenPxMeasure,
            ...options,
        },
    );
}

test('fixed-viewpoint blocks reflow continuously instead of preserving visual-line tails', () => {
    const result = build([node('p1', 0, 'paragraph', '汉'.repeat(14))]);

    assert.deepEqual(result.frames.map((frame) => frame.text), [
        '汉'.repeat(3),
        '汉'.repeat(3),
        '汉'.repeat(3),
        '汉'.repeat(3),
        '汉'.repeat(2),
    ]);
    assert.ok(result.frames.slice(0, -1).every((frame) => frame.text.length === 3));
    assert.ok(result.frames.every((frame) => frame.placement.display_scope === 'block'));
    assert.ok(result.frames.every((frame) => frame.placement.fixed_block_reflow === true));
    assert.equal(result.options.readingMode, 'focus');
});

test('moving-viewpoint blocks retain visual-line boundaries and line-tail short blocks', () => {
    const result = build([node('p1', 0, 'paragraph', '汉'.repeat(14))], {
        readingMode: 'moving',
    });

    assert.deepEqual(result.frames.map((frame) => frame.text), [
        '汉'.repeat(3),
        '汉'.repeat(3),
        '汉'.repeat(3),
        '汉',
        '汉'.repeat(3),
        '汉',
    ]);
    assert.deepEqual(result.frames.map((frame) => frame.placement.line_index), [0, 0, 0, 0, 1, 1]);
    assert.deepEqual(result.frames.map((frame) => frame.placement.x_px), [0, 30, 60, 90, 0, 30]);
});

test('fixed-viewpoint structural rows use intrinsic width so canonical TOC entries center like body blocks', () => {
    const prepared = StructurePolicy.prepareStructuredNodes([
        node('toc-1', 0, 'toc_item', '后记....235'),
    ]);
    assert.equal(prepared.length, 1);
    assert.equal(prepared[0].node_type, 'list_item');

    const result = build(prepared, {
        widthPercent: 25,
        maxWidthPx: 400,
    });

    assert.equal(result.frames.length, 1);
    const frame = result.frames[0];
    assert.equal(frame.text, '后记....235');
    assert.equal(frame.placement.structural_single_row, true);
    assert.equal(frame.placement.width_px, 90);
    assert.equal(frame.placement.x_px, 155);
    assert.equal(frame.placement.block_width_px, 100);
});

test('changing viewpoint while in Block forces one frame rebuild so grouping follows the new mode', () => {
    const calls = [];
    class FakeController {
        constructor() {
            this.mode = 'focus';
            this.scope = 'block';
        }
        readingMode() { return this.mode; }
        displayScope() { return this.scope; }
        adapterOptions() { return { displayScope: this.scope }; }
        onSettingChanged(options = {}) {
            calls.push({ ...options });
            return options;
        }
    }
    FakeController.prototype.__speedReadingLayoutIntegrityInstalled = true;

    const controller = new FakeController();
    const responsive = {
        buildMeasuredPlaybackFrames() {
            return { frames: [], options: {} };
        },
    };
    const root = {
        SpeedReadingResponsiveLayout: responsive,
        ReaderSpeedPlaybackUI: {
            ReaderSpeedPlaybackUIController: FakeController,
            getDefaultController: () => controller,
        },
    };

    assert.equal(Policy.install(root), true);
    assert.equal(controller.adapterOptions().readingMode, 'focus');

    controller.mode = 'moving';
    controller.onSettingChanged({ frames: false });
    assert.deepEqual(calls.pop(), { frames: true });
    assert.equal(controller.adapterOptions().readingMode, 'moving');

    controller.onSettingChanged({ frames: false });
    assert.deepEqual(calls.pop(), { frames: false });
});

test('block layout policy is loaded from the exact-head enhancement bootstrap', () => {
    const source = fs.readFileSync(require.resolve('../training-session-clock.js'), 'utf8');
    assert.match(source, /speedReadingBlockLayoutPolicyScript/u);
    assert.match(source, /speed-reading-block-layout-policy\.js/u);
    assert.match(source, /versionedSrc\(src\)/u);
});