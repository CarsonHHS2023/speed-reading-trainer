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

function titleAwareMeasure(text, nodeType) {
    const unit = nodeType === 'title' ? 15 : 10;
    return Array.from(String(text || '')).length * unit;
}

function productionStructuredAdapter() {
    assert.equal(Adapter.__structurePolicyInstalled, true);
    assert.equal(typeof Adapter.prepareStructuredNodes, 'function');
    return Adapter;
}

function build(nodes, options = {}) {
    const { adapter = Adapter, ...layoutOptions } = options;
    return Policy.buildBlockAwarePlaybackFrames(
        Layout.buildMeasuredPlaybackFrames,
        Layout,
        adapter,
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
            ...layoutOptions,
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
    assert.equal(result.options.paragraphLayout, false);
});

test('moving-viewpoint blocks retain visual-line boundaries, paragraph indent, and line-tail short blocks', () => {
    const result = build([node('p1', 0, 'paragraph', '汉'.repeat(14))], {
        readingMode: 'moving',
    });

    assert.deepEqual(result.frames.map((frame) => frame.text), [
        '汉'.repeat(3),
        '汉'.repeat(3),
        '汉',
        '汉'.repeat(3),
        '汉'.repeat(3),
        '汉',
    ]);
    assert.deepEqual(result.frames.map((frame) => frame.placement.line_index), [0, 0, 0, 1, 1, 1]);

    const indent = result.options.paragraphIndentPx;
    const expectedX = [indent, indent + 30, indent + 60, 0, 30, 60];
    result.frames.forEach((frame, index) => {
        assert.ok(Math.abs(frame.placement.x_px - expectedX[index]) < 0.001, `frame ${index} x`);
    });
    assert.equal(result.frames[0].lines[0].paragraph_start, true);
    assert.equal(result.frames[0].lines[0].paragraph_id, 'p1');
    assert.ok(result.frames.slice(1).every((frame) => frame.lines[0].paragraph_start !== true));
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

test('canonical TOC container restores title typography in fixed and moving Block modes', () => {
    const adapter = productionStructuredAdapter();
    const toc = node('toc-root', 0, 'toc', '目录');

    const fixed = build([toc], {
        adapter,
        widthPercent: 25,
        maxWidthPx: 400,
        measureText: titleAwareMeasure,
    });
    assert.equal(fixed.frames.length, 1);
    assert.equal(fixed.frames[0].node_type, 'title');
    assert.equal(fixed.frames[0].lines[0].node_type, 'title');
    assert.equal(fixed.frames[0].lines[0].toc_title, true);
    assert.equal(fixed.frames[0].lines[0].measured_width_px, 30);
    assert.equal(fixed.frames[0].placement.width_px, 30);
    assert.equal(fixed.frames[0].placement.x_px, 185);

    const moving = build([toc], {
        adapter,
        readingMode: 'moving',
        widthPercent: 25,
        maxWidthPx: 400,
        measureText: titleAwareMeasure,
    });
    assert.equal(moving.frames.length, 1);
    assert.equal(moving.frames[0].node_type, 'title');
    assert.equal(moving.frames[0].lines[0].node_type, 'title');
    assert.equal(moving.frames[0].lines[0].measured_width_px, 30);
});

test('synthetic TOC entries remain list-item typography instead of becoming titles', () => {
    const adapter = productionStructuredAdapter();
    const result = build([
        node('toc-root', 0, 'toc', '第一章....1\n第二章....2'),
    ], {
        adapter,
        widthPercent: 25,
        maxWidthPx: 400,
        measureText: titleAwareMeasure,
    });

    assert.equal(result.frames.length, 2);
    assert.deepEqual(result.frames.map((frame) => frame.node_type), ['list_item', 'list_item']);
    assert.ok(result.frames.every((frame) => frame.lines[0].node_type === 'list_item'));
    assert.ok(result.frames.every((frame) => frame.lines[0].toc_title !== true));
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
        onDisplayModeChanged() { return true; }
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

test('Block selector keeps Reader v2 width settings visible before a book is active', () => {
    let stopped = 0;
    let visibilityUpdates = 0;
    let visualUpdates = 0;
    let delegated = 0;

    class FakeController {
        constructor() {
            this.mode = 'focus';
            this.scope = 'block';
            this.active = false;
        }
        readingMode() { return this.mode; }
        displayScope() { return this.scope; }
        adapterOptions() { return { displayScope: this.scope }; }
        isReaderActive() { return this.active; }
        updateSettingsVisibility() { visibilityUpdates += 1; }
        applyVisualSettings() { visualUpdates += 1; }
        onDisplayModeChanged() { delegated += 1; return true; }
        onSettingChanged(options = {}) { return options; }
    }
    FakeController.prototype.__speedReadingLayoutIntegrityInstalled = true;

    const controller = new FakeController();
    const root = {
        SpeedReadingResponsiveLayout: {
            buildMeasuredPlaybackFrames() {
                return { frames: [], options: {} };
            },
        },
        ReaderSpeedPlaybackUI: {
            ReaderSpeedPlaybackUIController: FakeController,
            getDefaultController: () => controller,
        },
    };

    assert.equal(Policy.install(root), true);
    const event = { stopImmediatePropagation() { stopped += 1; } };

    assert.equal(controller.onDisplayModeChanged(event), false);
    assert.equal(stopped, 1, 'legacy app.js display-mode listener is blocked');
    assert.equal(visibilityUpdates, 1, 'Reader v2 refreshes Block/Line/Page panel visibility');
    assert.equal(visualUpdates, 1, 'the selected scope is reflected in visual settings');
    assert.equal(delegated, 0, 'no Reader reflow/frame work runs before a book is active');

    controller.active = true;
    assert.equal(controller.onDisplayModeChanged(event), true);
    assert.equal(stopped, 2);
    assert.equal(visibilityUpdates, 2);
    assert.equal(delegated, 1, 'active Reader still delegates to the normal reflow path');
});

test('block layout policy is loaded from the exact-head enhancement bootstrap', () => {
    const source = fs.readFileSync(require.resolve('../training-session-clock.js'), 'utf8');
    assert.match(source, /speedReadingBlockLayoutPolicyScript/u);
    assert.match(source, /speed-reading-block-layout-policy\.js/u);
    assert.match(source, /versionedSrc\(src\)/u);
});
