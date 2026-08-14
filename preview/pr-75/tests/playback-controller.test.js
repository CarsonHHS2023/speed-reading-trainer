const test = require('node:test');
const assert = require('node:assert/strict');
const { PlaybackController, STATES } = require('../playback-controller.js');

class FakeScheduler {
    constructor() {
        this.time = 0;
        this.nextId = 1;
        this.tasks = new Map();
    }
    now = () => this.time;
    setTimeout = (callback, delay) => {
        const id = this.nextId++;
        this.tasks.set(id, { at: this.time + Number(delay), callback });
        return id;
    };
    clearTimeout = (id) => this.tasks.delete(id);
    tick(ms) {
        const target = this.time + ms;
        while (true) {
            let chosen = null;
            for (const [id, task] of this.tasks) {
                if (task.at <= target && (!chosen || task.at < chosen.task.at || (task.at === chosen.task.at && id < chosen.id))) {
                    chosen = { id, task };
                }
            }
            if (!chosen) break;
            this.time = chosen.task.at;
            this.tasks.delete(chosen.id);
            chosen.task.callback();
        }
        this.time = target;
    }
}

function timed(id, node, duration) {
    return {
        frame_id: id,
        kind: 'timed_text',
        duration_ms: duration,
        identity: { candidate_id: 'cand', node_id: node, source_unit_id: 'su' },
    };
}

function manual(id, node) {
    return {
        frame_id: id,
        kind: 'manual',
        duration_ms: null,
        auto_advance: false,
        identity: { candidate_id: 'cand', node_id: node, source_unit_id: 'su' },
    };
}

test('play advances timed frames and completes deterministically', () => {
    const scheduler = new FakeScheduler();
    const controller = new PlaybackController({ scheduler });
    controller.setFrames([timed('f1', 'n1', 100), timed('f2', 'n2', 200)]);
    assert.equal(controller.play(), true);
    assert.equal(controller.state, STATES.PLAYING);
    scheduler.tick(100);
    assert.equal(controller.index, 1);
    scheduler.tick(199);
    assert.equal(controller.state, STATES.PLAYING);
    scheduler.tick(1);
    assert.equal(controller.state, STATES.COMPLETED);
    assert.equal(controller.index, 1);
});

test('pause and resume preserve remaining duration', () => {
    const scheduler = new FakeScheduler();
    const controller = new PlaybackController({ scheduler });
    controller.setFrames([timed('f1', 'n1', 1000), timed('f2', 'n2', 100)]);
    controller.play();
    scheduler.tick(250);
    assert.equal(controller.pause(), true);
    assert.equal(controller.remainingMs, 750);
    scheduler.tick(1000);
    assert.equal(controller.index, 0);
    controller.resume();
    scheduler.tick(749);
    assert.equal(controller.index, 0);
    scheduler.tick(1);
    assert.equal(controller.index, 1);
});

test('manual frame blocks until explicit continue', () => {
    const scheduler = new FakeScheduler();
    const controller = new PlaybackController({ scheduler });
    controller.setFrames([timed('f1', 'n1', 100), manual('m1', 'fig'), timed('f2', 'n2', 100)]);
    controller.play();
    scheduler.tick(100);
    assert.equal(controller.state, STATES.MANUAL);
    assert.equal(controller.index, 1);
    assert.equal(scheduler.tasks.size, 0);
    scheduler.tick(5000);
    assert.equal(controller.index, 1);
    assert.equal(controller.continueManual(), true);
    assert.equal(controller.state, STATES.PLAYING);
    assert.equal(controller.index, 2);
});

test('consecutive manual frames require one explicit continue per frame', () => {
    const scheduler = new FakeScheduler();
    const controller = new PlaybackController({ scheduler });
    controller.setFrames([timed('f1', 'n1', 100), manual('m1', 'fig'), manual('m2', 'tbl'), timed('f2', 'n2', 100)]);
    controller.play();
    scheduler.tick(100);
    assert.equal(controller.state, STATES.MANUAL);
    assert.equal(controller.index, 1);
    controller.continueManual();
    assert.equal(controller.state, STATES.MANUAL);
    assert.equal(controller.index, 2);
    assert.equal(scheduler.tasks.size, 0);
    controller.continueManual();
    assert.equal(controller.state, STATES.PLAYING);
    assert.equal(controller.index, 3);
    assert.equal(scheduler.tasks.size, 1);
});

test('seek into a manual frame always lands in manual state without autoplay', () => {
    const scheduler = new FakeScheduler();
    const controller = new PlaybackController({ scheduler });
    controller.setFrames([timed('f1', 'n1', 500), manual('m1', 'fig'), timed('f2', 'n2', 500)]);
    controller.seek(1 / 3);
    assert.equal(controller.index, 1);
    assert.equal(controller.state, STATES.MANUAL);
    assert.equal(scheduler.tasks.size, 0);
    controller.play();
    assert.equal(controller.state, STATES.MANUAL);
    assert.equal(scheduler.tasks.size, 0);
});

test('seek can restore a saved frame index without activating paused or manual playback', () => {
    const scheduler = new FakeScheduler();
    const controller = new PlaybackController({ scheduler });
    controller.setFrames([timed('f1', 'n1', 500), manual('m1', 'fig'), timed('f2', 'n2', 500)]);

    controller.seek(1 / 3, { activate: false });
    assert.equal(controller.index, 1);
    assert.equal(controller.currentFrame().frame_id, 'm1');
    assert.equal(controller.state, STATES.IDLE);
    assert.equal(scheduler.tasks.size, 0);
});

test('stop resets and seek maps progress to frame index', () => {
    const scheduler = new FakeScheduler();
    const controller = new PlaybackController({ scheduler });
    controller.setFrames([
        timed('f1', 'n1', 100), timed('f2', 'n2', 100), timed('f3', 'n3', 100), timed('f4', 'n4', 100),
    ]);
    controller.play();
    controller.seek(0.5);
    assert.equal(controller.index, 2);
    controller.stop();
    assert.equal(controller.state, STATES.IDLE);
    assert.equal(controller.index, 0);
});

test('previous and next cancel autoplay and land deterministically in paused/manual state', () => {
    const scheduler = new FakeScheduler();
    const controller = new PlaybackController({ scheduler });
    controller.setFrames([timed('f1', 'n1', 100), manual('m1', 'fig'), timed('f2', 'n2', 100)]);
    controller.play();
    scheduler.tick(20);
    controller.next();
    assert.equal(controller.index, 1);
    assert.equal(controller.state, STATES.MANUAL);
    scheduler.tick(1000);
    assert.equal(controller.index, 1);
    controller.next();
    assert.equal(controller.index, 2);
    assert.equal(controller.state, STATES.PAUSED);
    controller.previous();
    assert.equal(controller.index, 1);
    assert.equal(controller.state, STATES.MANUAL);
    controller.previous();
    assert.equal(controller.index, 0);
    assert.equal(controller.state, STATES.PAUSED);
    controller.previous();
    assert.equal(controller.index, 0);
});

test('frame rebuild preserves exact frame or stable node identity', () => {
    const scheduler = new FakeScheduler();
    const controller = new PlaybackController({ scheduler });
    controller.setFrames([timed('old-1', 'n1', 100), timed('old-2', 'n2', 100)]);
    controller.seek(0.5);
    assert.equal(controller.currentFrame().identity.node_id, 'n2');
    controller.setFrames([timed('new-1', 'n1', 100), timed('new-2a', 'n2', 50), timed('new-2b', 'n2', 50)]);
    assert.equal(controller.currentFrame().identity.node_id, 'n2');
    assert.equal(controller.currentFrame().frame_id, 'new-2a');
});

test('snapshot progress derives from frame index and count', () => {
    const controller = new PlaybackController({ scheduler: new FakeScheduler() });
    controller.setFrames([timed('f1', 'n1', 100), timed('f2', 'n2', 100), timed('f3', 'n3', 100)]);
    controller.seek(0.5);
    const snapshot = controller.snapshot();
    assert.equal(snapshot.index, 1);
    assert.equal(snapshot.frame_count, 3);
    assert.equal(snapshot.progress, 1 / 3);
});
