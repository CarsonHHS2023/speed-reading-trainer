(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderPunctuationHangingPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // This policy is deliberately punctuation-only. A previous implementation
    // matched "one character + closing punctuation" and moved both pieces back to
    // the preceding line. That corrupts valid wraps such as "观）" or "平，",
    // where the character legitimately belongs to the new line. Only punctuation
    // that is itself at the beginning of a line may hang into the preceding line.
    const LEADING_CLOSING_PUNCTUATION = /^([,.;:!?%\)\]\}，。；：！？％、…—”’）】》〉」』〕］｝]+)/u;
    const HARD_STRUCTURE_TYPES = new Set([
        'title', 'heading', 'list', 'list_item', 'toc', 'toc_item',
        'caption', 'quote', 'code', 'reference',
    ]);

    function normalizeType(value) {
        return String(value || '').trim().toLowerCase().replace(/[\s-]+/gu, '_');
    }

    function lineNodeIds(line) {
        const ids = new Set();
        const add = (identity) => {
            const nodeId = String(identity?.node_id || '').trim();
            if (nodeId) ids.add(nodeId);
        };
        add(line?.identity);
        for (const identity of line?.source_spans || []) add(identity);
        return ids;
    }

    function isHardStructureLine(line) {
        return Boolean(line?.structural_single_row) || HARD_STRUCTURE_TYPES.has(normalizeType(line?.node_type));
    }

    function sameLogicalTextSource(previousLine, currentLine) {
        if (!previousLine || !currentLine) return false;
        if (isHardStructureLine(previousLine) || isHardStructureLine(currentLine)) return false;
        const previousIds = lineNodeIds(previousLine);
        const currentIds = lineNodeIds(currentLine);
        if (!previousIds.size || !currentIds.size) return false;
        for (const nodeId of currentIds) {
            if (previousIds.has(nodeId)) return true;
        }
        return false;
    }

    function refreshFrameTiming(frame, adapter, speedPerMinute) {
        if (frame?.kind !== 'timed_text' || !Array.isArray(frame.lines)) return frame;
        frame.text = frame.lines.map((line) => line.text).join('\n');
        frame.reading_units = adapter?.countReadingUnits?.(frame.text) ?? frame.reading_units;
        if (typeof adapter?.frameDurationMs === 'function' && Number.isFinite(Number(speedPerMinute))) {
            frame.duration_ms = adapter.frameDurationMs(frame.reading_units, Number(speedPerMinute));
        }
        return frame;
    }

    function repairHangingPunctuation(frames, adapter, speedPerMinute) {
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
                const match = sameLogicalTextSource(previousLine, line)
                    ? text.match(LEADING_CLOSING_PUNCTUATION)
                    : null;
                if (match) {
                    previousLine.text = `${String(previousLine.text || '').replace(/\s+$/u, '')}${match[1]}`;
                    line.text = text.slice(match[0].length).replace(/^\s+/u, '');
                }
                if (line.text) {
                    kept.push(line);
                    previousLine = line;
                }
            }
            frame.lines = kept;
        }

        // A punctuation-only repair can still reach back into the previous timed
        // frame, so recompute all frame text/timing after the complete pass.
        for (const frame of frames || []) refreshFrameTiming(frame, adapter, speedPerMinute);
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
        HARD_STRUCTURE_TYPES,
        LEADING_CLOSING_PUNCTUATION,
        install,
        isHardStructureLine,
        lineNodeIds,
        normalizeType,
        refreshFrameTiming,
        repairHangingPunctuation,
        sameLogicalTextSource,
    };
});