const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { TrainingSessionClock, CLOCK_STATES } = require('../training-session-clock.js');

function fakeNow() {
    let value = 0;
    return {
        now: () => value,
        advance(ms) { value += ms; },
    };
}

test('training clock counts comprehension/manual time while it remains running', () => {
    const time = fakeNow();
    const clock = new TrainingSessionClock({ now: time.now });
    clock.start();
    time.advance(1200);
    // Auto-play may be paused elsewhere; the training clock is intentionally independent.
    time.advance(1800);
    assert.equal(clock.elapsedMs(), 3000);
    assert.equal(clock.state, CLOCK_STATES.RUNNING);
});

test('explicit training pause excludes paused wall time', () => {
    const time = fakeNow();
    const clock = new TrainingSessionClock({ now: time.now });
    clock.start();
    time.advance(1500);
    assert.equal(clock.pause(), true);
    assert.equal(clock.elapsedMs(), 1500);
    time.advance(5000);
    assert.equal(clock.elapsedMs(), 1500);
    assert.equal(clock.resume(), true);
    time.advance(500);
    assert.equal(clock.elapsedMs(), 2000);
});

test('stop freezes elapsed time and a new start resets the session', () => {
    const time = fakeNow();
    const clock = new TrainingSessionClock({ now: time.now });
    clock.start();
    time.advance(750);
    assert.equal(clock.stop(), 750);
    time.advance(1000);
    assert.equal(clock.elapsedMs(), 750);
    clock.start();
    assert.equal(clock.elapsedMs(), 0);
    time.advance(250);
    assert.equal(clock.elapsedMs(), 250);
});

test('training clock has no enhancement-bootstrap side effects', () => {
    const source = fs.readFileSync(require.resolve('../training-session-clock.js'), 'utf8');
    assert.doesNotMatch(source, /speed-reading-[a-z-]+\.js/u);
    assert.doesNotMatch(source, /appendEnhancementScript/u);
    assert.doesNotMatch(source, /data-reader-enhancement/u);
});