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

if (typeof document !== 'undefined') {
    const PRODUCTION_ASSET_VERSION = '2026-08-09-speed-reading-core-v1';
    const previewHead = document.querySelector?.('meta[name="reader-preview-head"]')?.getAttribute?.('content') || '';
    const assetVersion = previewHead || PRODUCTION_ASSET_VERSION;
    const versionedSrc = (src) => `${src}?v=${encodeURIComponent(assetVersion)}`;

    function appendEnhancementScript(id, src, options = {}) {
        if (document.getElementById(id)) return;
        const script = document.createElement('script');
        script.id = id;
        script.async = false;
        script.src = versionedSrc(src);
        if (options.lifecycleManaged === true) {
            script.dataset.readerEnhancement = src;
            script.addEventListener('load', () => {
                script.dataset.loaded = '1';
            }, { once: true });
        }
        document.head.appendChild(script);
    }

    // Structure policy must be fresh before measured playback is built. Mark the
    // lifecycle-managed scripts so ReaderResumeLifecycle can wait on the same tag
    // instead of creating a duplicate loader during startup.
    appendEnhancementScript('speedReadingStructurePolicyScript', 'speed-reading-structure-policy.js', { lifecycleManaged: true });
    appendEnhancementScript('speedReadingFormulaRenderingScript', 'speed-reading-formula-rendering.js');
    appendEnhancementScript('speedReadingResponsiveLayoutScript', 'speed-reading-responsive-layout.js', { lifecycleManaged: true });
    appendEnhancementScript('speedReadingLayoutIntegrityScript', 'speed-reading-layout-integrity.js');
}
