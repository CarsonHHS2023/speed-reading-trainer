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

test('speed policy is loaded from the exact-head enhancement bootstrap', () => {
    const source = fs.readFileSync(require.resolve('../training-session-clock.js'), 'utf8');
    assert.match(source, /speedReadingSpeedPolicyScript/u);
    assert.match(source, /speed-reading-speed-policy\.js/u);
    assert.match(source, /versionedSrc\(src\)/u);
});
