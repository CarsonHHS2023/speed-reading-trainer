(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderLineflowPolish = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const LEADING_CLOSING_PUNCTUATION = /^[,.;:!?%。，；：！？％、…—”’）】》〉」』〕］｝]+/u;
    const DEFAULT_MEASURE_RESERVE_PX = 48;
    const FONT_MEASURE_RESERVE_RATIO = 1.5;
    const WRAPPABLE_STRUCTURE_TYPES = Object.freeze(['list', 'list_item']);

    function measureReservePx(options = {}) {
        const fontSizePx = Math.max(
            0,
            Number(options?.fontSizePx || options?.fontSize || 0) || 0,
        );
        return Math.max(DEFAULT_MEASURE_RESERVE_PX, fontSizePx * FONT_MEASURE_RESERVE_RATIO);
    }

    function enableWrappedStructureRows(layout) {
        const singleRowTypes = layout?.SINGLE_ROW_TYPES;
        if (!singleRowTypes || typeof singleRowTypes.delete !== 'function') return false;
        for (const nodeType of WRAPPABLE_STRUCTURE_TYPES) singleRowTypes.delete(nodeType);
        return true;
    }

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

        // A semantic list/list_item is a hard structure boundary, not a promise that
        // its entire text must fit one visual row. Keep titles/headings/TOC atomic
        // for their dedicated presentation rules, but let long list content use the
        // normal measured wrapping path in Page, Line, and Block modes.
        enableWrappedStructureRows(rootObject?.SpeedReadingResponsiveLayout);

        const originalAdapterOptions = Controller.prototype.adapterOptions;
        Controller.prototype.adapterOptions = function lineflowAdapterOptions() {
            const options = originalAdapterOptions.call(this);
            const reserve = measureReservePx(options);
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
        FONT_MEASURE_RESERVE_RATIO,
        LEADING_CLOSING_PUNCTUATION,
        WRAPPABLE_STRUCTURE_TYPES,
        enableWrappedStructureRows,
        install,
        measureReservePx,
        rebalanceFrameLines,
    };
});
