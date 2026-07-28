const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Adapter = require('../speed-reading-adapter.js');
const { PlaybackController, STATES } = require('../playback-controller.js');
const { TrainingSessionClock } = require('../training-session-clock.js');
const Resume = require('../reader-resume.js');
const {
    pdfDocument,
    pdfNodes,
    txtDocument,
    txtNodes,
} = require('./fixtures/speed-reading-mvp.js');

function schedulerHarness() {
    let now = 0;
    let nextId = 1;
    const timers = new Map();
    const scheduler = {
        now: () => now,
        setTimeout(callback, delay) {
            const id = nextId++;
            timers.set(id, { callback, at: now + Math.max(0, Number(delay) || 0) });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
    };
    function advance(ms) {
        const target = now + ms;
        while (true) {
            const due = [...timers.entries()]
                .filter(([, timer]) => timer.at <= target)
                .sort((a, b) => a[1].at - b[1].at)[0];
            if (!due) break;
            const [id, timer] = due;
            timers.delete(id);
            now = timer.at;
            timer.callback();
        }
        now = target;
    }
    return { scheduler, advance, pending: () => timers.size, now: () => now };
}

function memoryStorage() {
    const data = new Map();
    return {
        getItem: (key) => data.has(key) ? data.get(key) : null,
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key),
    };
}

function stripDuration(frame) {
    const { duration_ms, ...rest } = frame;
    return rest;
}

function advanceTimedFramesUntilManual(playback, time, limit = 1000) {
    let advanced = 0;
    while (playback.state === STATES.PLAYING) {
        const frame = playback.currentFrame();
        assert.equal(frame?.kind, 'timed_text');
        time.advance(frame.duration_ms);
        advanced += 1;
        assert.ok(advanced < limit, 'playback did not reach a manual frame within the safety bound');
    }
    assert.equal(playback.state, STATES.MANUAL);
    return advanced;
}

test('PDF acceptance: physical pages, timed/manual sequencing, Continue, and semantic resume stay coherent', () => {
    const built = Adapter.buildPlaybackFrames(pdfDocument, pdfNodes, {
        displayScope: 'page',
        lineWidth: 8,
        maxLines: 1,
        speedPerMinute: 60000,
    });

    const manualFrames = built.frames.filter((frame) => frame.kind === 'manual');
    assert.deepEqual(manualFrames.map((frame) => frame.identity.node_id), [
        'pdf-figure-1', 'pdf-formula-1',
    ]);
    assert.ok(manualFrames.every((frame) => frame.duration_ms === null && frame.auto_advance === false));

    const figureIndex = built.frames.findIndex((frame) => frame.identity.node_id === 'pdf-figure-1');
    const formulaIndex = built.frames.findIndex((frame) => frame.identity.node_id === 'pdf-formula-1');
    assert.ok(figureIndex > 0);
    assert.ok(formulaIndex > figureIndex + 1);
    assert.ok(formulaIndex < built.frames.length - 1);

    const beforeFigure = built.frames.slice(0, figureIndex);
    const betweenManualFrames = built.frames.slice(figureIndex + 1, formulaIndex);
    const afterFormula = built.frames.slice(formulaIndex + 1);
    assert.ok(beforeFigure.every((frame) => frame.kind === 'timed_text' && frame.identity.source_unit_id === 'pdf-page-1'));
    assert.ok(betweenManualFrames.every((frame) => frame.kind === 'timed_text' && frame.identity.source_unit_id === 'pdf-page-2'));
    assert.ok(afterFormula.every((frame) => frame.kind === 'timed_text' && frame.identity.source_unit_id === 'pdf-page-2'));
    assert.equal(beforeFigure.some((frame) => frame.text.includes('第二页')), false);
    assert.equal(betweenManualFrames.some((frame) => frame.text.includes('第一章')), false);

    const time = schedulerHarness();
    const playback = new PlaybackController({ scheduler: time.scheduler });
    playback.setFrames(built.frames, { preserveIdentity: false });
    assert.equal(playback.play(), true);
    assert.equal(playback.state, STATES.PLAYING);
    assert.equal(advanceTimedFramesUntilManual(playback, time), figureIndex);
    assert.equal(playback.currentFrame().identity.node_id, 'pdf-figure-1');
    assert.equal(time.pending(), 0);

    assert.equal(playback.continueManual(), true);
    assert.equal(playback.state, STATES.PLAYING);
    assert.equal(playback.currentFrame().identity.source_unit_id, 'pdf-page-2');

    playback.seek(formulaIndex / built.frames.length);
    assert.equal(playback.state, STATES.MANUAL);
    assert.equal(playback.currentFrame().identity.node_id, 'pdf-formula-1');
    assert.equal(time.pending(), 0);

    const frame = playback.currentFrame();
    const record = Resume.recordForLocation(pdfDocument, frame.identity, {
        frameId: frame.frame_id,
        frameOrdinal: frame.frame_ordinal,
        updatedAt: 1234,
    });
    assert.equal(record.node_id, 'pdf-formula-1');
    assert.equal(record.source_unit_id, 'pdf-page-2');
    assert.equal(record.frame_id, frame.frame_id);
    assert.equal(Object.hasOwn(record, 'page_id'), false);
    assert.equal(Object.hasOwn(record, 'presentation_id'), false);
    assert.equal(Object.hasOwn(record, 'scroll_offset'), false);

    const store = new Resume.ReaderResumeStoreV2({ storage: memoryStorage() });
    assert.deepEqual(store.write(record), record);
    assert.equal(Resume.sameCandidate(store.read(pdfDocument.document_ref), pdfDocument), true);
    assert.equal(Resume.sameCandidate(store.read(pdfDocument.document_ref), { ...pdfDocument, candidate_id: 'candidate-pdf-v2' }), false);
});

test('TXT acceptance: mixed-language lexical rules, deterministic reflow, and speed-only invariance survive full frame construction', () => {
    const compactOptions = { displayScope: 'page', lineWidth: 40, maxLines: 10, speedPerMinute: 600 };
    const narrowOptions = { displayScope: 'page', lineWidth: 10, maxLines: 2, speedPerMinute: 600 };
    const compact = Adapter.buildPlaybackFrames(txtDocument, txtNodes, compactOptions);
    const narrow = Adapter.buildPlaybackFrames(txtDocument, txtNodes, narrowOptions);
    const narrowAgain = Adapter.buildPlaybackFrames(txtDocument, [...txtNodes].reverse(), narrowOptions);

    assert.ok(compact.frames.length < narrow.frames.length);
    assert.deepEqual(narrow.frames, narrowAgain.frames);
    assert.ok(narrow.frames.every((frame) => frame.identity.source_unit_id === 'txt-flow-1'));
    assert.ok(narrow.frames.every((frame) => !frame.frame_id.includes('page')));

    const allText = narrow.frames.map((frame) => frame.text).join('\n');
    assert.match(allText, /state-of-the-art/);
    assert.equal((allText.match(/state-of-the-art/g) || []).length, 1);
    assert.match(allText, /test@example\.com/);
    assert.match(allText, /2026-07-27/);
    assert.equal(Adapter.countReadingUnits('中文 alpha 12.5%'), 8);

    const fast = Adapter.buildPlaybackFrames(txtDocument, txtNodes, {
        ...narrowOptions,
        speedPerMinute: 1200,
    });
    assert.deepEqual(narrow.frames.map(stripDuration), fast.frames.map(stripDuration));
    assert.ok(narrow.frames.some((frame, index) => frame.duration_ms !== fast.frames[index].duration_ms));
});

test('acceptance timing: comprehension/manual time counts, explicit training pause does not', () => {
    let now = 0;
    const clock = new TrainingSessionClock({ now: () => now });
    const time = schedulerHarness();
    const built = Adapter.buildPlaybackFrames(pdfDocument, pdfNodes, {
        displayScope: 'page', speedPerMinute: 60000,
    });
    const playback = new PlaybackController({ scheduler: time.scheduler });
    playback.setFrames(built.frames, { preserveIdentity: false });

    clock.start();
    playback.play();
    now += 400;
    playback.pause();
    assert.equal(playback.state, STATES.PAUSED);
    now += 1600; // comprehension pause: still training
    assert.equal(clock.elapsedMs(), 2000);
    playback.resume();

    advanceTimedFramesUntilManual(playback, time);
    assert.equal(playback.currentFrame().identity.node_id, 'pdf-figure-1');
    now += 900; // figure inspection: still training
    assert.equal(clock.elapsedMs(), 2900);

    clock.pause();
    now += 5000; // explicit training pause: excluded
    assert.equal(clock.elapsedMs(), 2900);
    clock.resume();
    now += 100;
    assert.equal(clock.elapsedMs(), 3000);
});

test('acceptance architecture boundary keeps selected-book Speed Reading on Reader v2 only', () => {
    const sources = [
        'speed-reading-adapter.js',
        'playback-controller.js',
        'training-session-clock.js',
        'reader-speed-playback-ui.js',
        'reader-resume.js',
    ].map((file) => fs.readFileSync(require.resolve(`../${file}`), 'utf8')).join('\n');

    for (const forbidden of [
        '/api/reader/v1',
        '/api/v1/books/',
        'cachedContentBlob',
        'tokenizeContent(',
        'imageMarkerMap',
        'presentation_id',
        'page_id',
        'scroll_offset',
        'token_index',
    ]) {
        assert.equal(sources.includes(forbidden), false, forbidden);
    }

    const bookshelf = fs.readFileSync(require.resolve('../bookshelf.js'), 'utf8');
    assert.equal(/\/api\/v1\/books\/.*\/content/.test(bookshelf), false);
    assert.equal(bookshelf.includes('BookShelf.prototype.selectBook'), false);
});
