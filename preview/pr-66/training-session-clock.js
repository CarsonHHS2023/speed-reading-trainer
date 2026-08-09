(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderTrainingSessionClock = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const CLOCK_STATES = Object.freeze({
        IDLE: 'idle',
        RUNNING: 'running',
        PAUSED: 'paused',
        STOPPED: 'stopped',
    });

    class TrainingSessionClock {
        constructor(options = {}) {
            this.now = typeof options.now === 'function' ? options.now : () => Date.now();
            this.state = CLOCK_STATES.IDLE;
            this.accumulatedMs = 0;
            this.startedAt = null;
        }

        start(options = {}) {
            const reset = options.reset !== false;
            if (reset) this.accumulatedMs = 0;
            this.startedAt = this.now();
            this.state = CLOCK_STATES.RUNNING;
            return this.elapsedMs();
        }

        pause() {
            if (this.state !== CLOCK_STATES.RUNNING) return false;
            this.accumulatedMs = this.elapsedMs();
            this.startedAt = null;
            this.state = CLOCK_STATES.PAUSED;
            return true;
        }

        resume() {
            if (this.state !== CLOCK_STATES.PAUSED) return false;
            this.startedAt = this.now();
            this.state = CLOCK_STATES.RUNNING;
            return true;
        }

        stop() {
            if (this.state === CLOCK_STATES.RUNNING) this.accumulatedMs = this.elapsedMs();
            this.startedAt = null;
            if (this.state !== CLOCK_STATES.IDLE) this.state = CLOCK_STATES.STOPPED;
            return this.accumulatedMs;
        }

        reset() {
            this.accumulatedMs = 0;
            this.startedAt = null;
            this.state = CLOCK_STATES.IDLE;
        }

        elapsedMs() {
            if (this.state === CLOCK_STATES.RUNNING && this.startedAt !== null) {
                return Math.max(0, this.accumulatedMs + (this.now() - this.startedAt));
            }
            return Math.max(0, this.accumulatedMs);
        }
    }

    return { TrainingSessionClock, CLOCK_STATES };
});

if (typeof document !== 'undefined' && !document.getElementById('speedReadingResponsiveLayoutScript')) {
    const script = document.createElement('script');
    const previewHead = document.querySelector?.('meta[name="reader-preview-head"]')?.getAttribute?.('content') || '';
    script.id = 'speedReadingResponsiveLayoutScript';
    script.src = previewHead
        ? `speed-reading-responsive-layout.js?v=${encodeURIComponent(previewHead)}`
        : 'speed-reading-responsive-layout.js';
    document.head.appendChild(script);
}
