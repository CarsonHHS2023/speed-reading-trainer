(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderPunctuationHangingPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // Single-cell closing punctuation hangs on the preceding line. Two-cell punctuation
    // such as —— and …… is explicitly allowed to begin a line.
    const CARRIED_CHARACTER_AND_PUNCTUATION = /^([^\s，。；：！？、”’）】》〉」』〕］｝])([，。；：！？、”’）】》〉」』〕］｝]+)/u;

    function repairHangingPunctuation(frames, adapter, speedPerMinute) {
        let previousLine = null;
        for (const frame of frames || []) {
            if (frame?.kind !== 'timed_text' || !Array.isArray(frame.lines)) {
                previousLine = null;
                continue;
            }

            const kept = [];
            for (const sourceLine of frame.lines) {
                const line = { ...sourceLine, text: String(sourceLine?.text || '').replace(/^\s+/u, '') };
                const match = previousLine ? line.text.match(CARRIED_CHARACTER_AND_PUNCTUATION) : null;
                if (match) {
                    previousLine.text = `${String(previousLine.text || '').replace(/\s+$/u, '')}${match[1]}${match[2]}`;
                    line.text = line.text.slice(match[0].length).replace(/^\s+/u, '');
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
        const Controller = rootObject?.ReaderSpeedPlaybackUI?.ReaderSpeedPlaybackUIController;
        const adapter = rootObject?.SpeedReadingAdapter;
        if (!Controller || !adapter || Controller.prototype.__punctuationHangingPolicyInstalled) return false;

        const originalRefreshFrames = Controller.prototype.refreshFrames;
        Controller.prototype.refreshFrames = function punctuationHangingRefreshFrames(options = {}) {
            const frames = originalRefreshFrames.call(this, options) || [];
            const settings = this.adapterOptions?.() || {};
            repairHangingPunctuation(frames, adapter, settings.speedPerMinute);
            this.playback?.setFrames?.(frames, { preserveIdentity: options.preserveIdentity !== false });
            this.updateControls?.();
            return frames;
        };

        Controller.prototype.__punctuationHangingPolicyInstalled = true;
        return true;
    }

    return {
        CARRIED_CHARACTER_AND_PUNCTUATION,
        install,
        repairHangingPunctuation,
    };
});