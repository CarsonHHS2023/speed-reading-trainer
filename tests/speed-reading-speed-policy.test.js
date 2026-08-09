const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Adapter = require('../speed-reading-adapter.js');
const Policy = require('../speed-reading-speed-policy.js');

function fixedMeasure(width) {
    return () => width;
}

function control(value, min = '100', max = '10000') {
    return {
        value: String(value),
        min: String(min),
        max: String(max),
        style: {},
    };
}

function eventControl(value, min = '100', max = '10000') {
    const listeners = new Map();
    return {
        ...control(value, min, max),
        addEventListener(type, callback) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(callback);
        },
        dispatch(type) {
            for (const callback of listeners.get(type) || []) callback({ target: this });
        },
    };
}

test('all timed frames use a one-sixth-second minimum dwell', () => {
    assert.equal(Adapter.MIN_FRAME_DURATION_MS, 1000 / 6);
    assert.equal(Adapter.durationMs(1, 1000000), 1000 / 6);
    assert.equal(Adapter.durationMs(100, 1000000), 1000 / 6);
});

test('line-scope maximum speed follows measured characters per line and configured line count', () => {
    const maximum = Policy.maximumSpeedPerMinute({
        displayScope: 'line',
        maxWidthPx: 700,
        widthPercent: 100,
        lineCount: 4,
        pageLineCapacity: 10,
        measureText: fixedMeasure(28),
        fontSizePx: 28,
    }, Adapter);

    // 700 / 28 = 25 chars per line; 25 * 4 = 100 units per frame;
    // one frame per 1/6 second => 100 * 6 * 60 = 36,000 units/minute.
    assert.equal(maximum, 36000);
});

test('block scope uses one visible row while page scope uses automatic page capacity', () => {
    const base = {
        maxWidthPx: 700,
        widthPercent: 100,
        lineCount: 4,
        pageLineCapacity: 6,
        measureText: fixedMeasure(28),
        fontSizePx: 28,
    };

    assert.equal(Policy.maximumSpeedPerMinute({ ...base, displayScope: 'block' }, Adapter), 9000);
    assert.equal(Policy.maximumSpeedPerMinute({ ...base, displayScope: 'line' }, Adapter), 36000);
    assert.equal(Policy.maximumSpeedPerMinute({ ...base, displayScope: 'page' }, Adapter), 54000);
});

test('line scope cannot assume more rows than fit in the current reading area', () => {
    const maximum = Policy.maximumSpeedPerMinute({
        displayScope: 'line',
        maxWidthPx: 700,
        widthPercent: 100,
        lineCount: 4,
        pageLineCapacity: 2,
        measureText: fixedMeasure(28),
    }, Adapter);

    assert.equal(maximum, 18000);
});

test('speed controls expose the computed maximum and clamp an over-limit current speed', () => {
    const slider = control(50000);
    const input = control(50000);
    const unit = { textContent: '' };
    const label = { textContent: '' };
    const fixed = { value: 'focus', textContent: '焦点式' };
    const moving = { value: 'moving', textContent: '移动式' };
    const mode = {
        options: [fixed, moving],
        closest() { return { querySelector() { return label; } }; },
    };
    const elements = { speedSlider: slider, speedInput: input, speedUnit: unit, trainingMode: mode };
    const controller = {
        document: { querySelector() { return null; } },
        element(id) { return elements[id] || null; },
    };

    const result = Policy.applySpeedRangeControls(controller, 36000);

    assert.equal(result.speedPerMinute, 36000);
    assert.equal(slider.max, '36000');
    assert.equal(input.max, '36000');
    assert.equal(slider.value, '36000');
    assert.equal(input.value, '36000');
    assert.equal(unit.textContent, '字/分钟');
    assert.equal(label.textContent, '视点模式：');
    assert.equal(fixed.textContent, '固定式');
    assert.equal(moving.textContent, '移动式');
    assert.equal(input.style.width, '72px');
});

test('installed policy recomputes maximum from live width and line controls', () => {
    const speedSlider = eventControl(5000);
    const speedInput = eventControl(5000);
    const widthSlider = eventControl(100, 20, 100);
    const widthInput = eventControl(100, 20, 100);
    const linesSlider = eventControl(4, 1, 10);
    const linesInput = eventControl(4, 1, 10);
    const fontSlider = eventControl(28, 16, 48);
    const fontInput = eventControl(28, 16, 48);
    const fontWeight = eventControl('normal');
    const displayMode = eventControl('line');
    const speedUnit = { textContent: '' };
    const viewpointLabel = { textContent: '' };
    const trainingMode = eventControl('focus');
    trainingMode.options = [
        { value: 'focus', textContent: '焦点式' },
        { value: 'moving', textContent: '移动式' },
    ];
    trainingMode.closest = () => ({ querySelector: () => viewpointLabel });
    const focusText = {};
    const elements = {
        speedSlider, speedInput, speedUnit,
        widthSlider, widthInput,
        linesSlider, linesInput,
        fontSlider, fontInput, fontWeight,
        displayMode, trainingMode, focusText,
    };

    class FakeController {
        constructor() {
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
                querySelector() { return null; },
            };
        }

        element(id) { return elements[id] || null; }
        updateSettingsVisibility() {}
        applyVisualSettings() {}
        displayScope() { return 'line'; }
        playbackAvailableHeight() { return 600; }
        adapterOptions() {
            return {
                displayScope: 'line',
                widthPercent: Number(widthInput.value),
                lineCount: Number(linesInput.value),
                maxLines: Number(linesInput.value),
                maxWidthPx: 700,
                speedPerMinute: Number(speedInput.value),
            };
        }
        refreshFrames() { return []; }
    }
    FakeController.prototype.__speedReadingLayoutIntegrityInstalled = true;

    const controller = new FakeController();
    const root = {
        ReaderSpeedPlaybackUI: {
            ReaderSpeedPlaybackUIController: FakeController,
            getDefaultController: () => controller,
        },
        SpeedReadingAdapter: Adapter,
        SpeedReadingResponsiveLayout: {
            DEFAULT_LINE_HEIGHT_RATIO: 1.55,
            DEFAULT_SAFE_VERTICAL_GUTTER_PX: 72,
            createCanvasMeasurer: () => fixedMeasure(28),
            pageLineCapacity: () => 10,
        },
    };

    assert.equal(Policy.install(root), true);
    assert.equal(speedSlider.max, '36000');
    assert.equal(speedInput.max, '36000');

    widthSlider.value = '50';
    widthSlider.dispatch('input');
    assert.equal(widthInput.value, '50');
    assert.equal(speedSlider.max, '17280');
    assert.equal(speedInput.max, '17280');

    linesSlider.value = '2';
    linesSlider.dispatch('input');
    assert.equal(linesInput.value, '2');
    assert.equal(speedSlider.max, '8640');
    assert.equal(speedInput.max, '8640');
});

test('speed policy is loaded from the exact-head enhancement bootstrap', () => {
    const source = fs.readFileSync(require.resolve('../training-session-clock.js'), 'utf8');
    assert.match(source, /speedReadingSpeedPolicyScript/u);
    assert.match(source, /speed-reading-speed-policy\.js/u);
    assert.match(source, /versionedSrc\(src\)/u);
});
