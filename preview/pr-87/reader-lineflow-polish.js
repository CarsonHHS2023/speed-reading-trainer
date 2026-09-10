(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderLineflowPolish = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const LEADING_CLOSING_PUNCTUATION = /^[,.;:!?%。，；：！？％、…—”’）】》〉」』〕］｝]+/u;
    const DEFAULT_MEASURE_RESERVE_PX = 28;

    function rebalanceFrameLines(frames, adapter, speedPerMinute) {
        let previousLine = null;
        for (const frame of frames || []) {
            if (frame?.kind !== 'timed_text' || !Array.isArray(frame.lines)) {
                previousLine = null;
                continue;
            }
            const kept = [];
            for (const sourceLine of frame.lines) {
                const line = { ...sourceLine };
                const text = String(line.text || '');
                const match = text.match(LEADING_CLOSING_PUNCTUATION);
                if (match && previousLine) {
                    previousLine.text = `${String(previousLine.text || '').replace(/\s+$/u, '')}${match[0]}`;
                    line.text = text.slice(match[0].length).replace(/^\s+/u, '');
                }
                if (line.text) {
                    kept.push(line);
                    previousLine = line;
                }
            }
            frame.lines = kept;
            frame.text = kept.map((line) => line.text).join('\n');
            frame.reading_units = adapter?.countReadingUnits?.(frame.text) ?? frame.reading_units;
            if (typeof adapter?.frameDurationMs === 'function' && Number.isFinite(Number(speedPerMinute))) {
                frame.duration_ms = adapter.frameDurationMs(frame.reading_units, Number(speedPerMinute));
            }
        }
        return frames;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const PlaybackUI = rootObject?.ReaderSpeedPlaybackUI;
        const Controller = PlaybackUI?.ReaderSpeedPlaybackUIController;
        const adapter = rootObject?.SpeedReadingAdapter;
        if (!Controller || !adapter || Controller.prototype.__lineflowPolishInstalled) return false;

        const originalAdapterOptions = Controller.prototype.adapterOptions;
        Controller.prototype.adapterOptions = function lineflowAdapterOptions() {
            const options = originalAdapterOptions.call(this);
            const reserve = Math.max(DEFAULT_MEASURE_RESERVE_PX, Number(options?.fontSize || 0) * 0.5 || 0);
            return {
                ...options,
                maxWidthPx: Math.max(1, Number(options.maxWidthPx || 1) - reserve),
                lineflowMeasureReservePx: reserve,
            };
        };

        const originalRefreshFrames = Controller.prototype.refreshFrames;
        Controller.prototype.refreshFrames = function lineflowRefreshFrames(options = {}) {
            const frames = originalRefreshFrames.call(this, options) || [];
            const settings = this.adapterOptions();
            rebalanceFrameLines(frames, adapter, settings.speedPerMinute);
            this.playback.setFrames(frames, { preserveIdentity: options.preserveIdentity !== false });
            this.updateControls?.();
            return frames;
        };

        Controller.prototype.__lineflowPolishInstalled = true;
        return true;
    }

    return {
        DEFAULT_MEASURE_RESERVE_PX,
        LEADING_CLOSING_PUNCTUATION,
        install,
        rebalanceFrameLines,
    };
});
