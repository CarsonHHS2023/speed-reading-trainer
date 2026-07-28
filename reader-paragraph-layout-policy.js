(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderParagraphLayoutPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const PARAGRAPH_TYPES = new Set(['paragraph', 'unknown']);

    function lineIdentity(line) {
        const first = Array.isArray(line?.source_spans) ? line.source_spans[0] : line?.identity;
        return `${first?.source_unit_id || ''}\u0000${first?.node_id || ''}`;
    }

    function markParagraphStarts(frames) {
        let previousParagraphIdentity = null;
        for (const frame of frames || []) {
            if (frame?.kind !== 'timed_text' || !Array.isArray(frame.lines)) {
                previousParagraphIdentity = null;
                continue;
            }
            frame.lines = frame.lines.map((sourceLine) => {
                const line = { ...sourceLine };
                if (!PARAGRAPH_TYPES.has(line.node_type)) {
                    previousParagraphIdentity = null;
                    line.paragraph_start = false;
                    return line;
                }
                const identity = lineIdentity(line);
                line.paragraph_start = Boolean(identity && identity !== previousParagraphIdentity);
                previousParagraphIdentity = identity || previousParagraphIdentity;
                return line;
            });
        }
        return frames;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const Controller = rootObject?.ReaderSpeedPlaybackUI?.ReaderSpeedPlaybackUIController;
        if (!Controller || Controller.prototype.__paragraphLayoutPolicyInstalled) return false;

        const originalRefreshFrames = Controller.prototype.refreshFrames;
        Controller.prototype.refreshFrames = function paragraphLayoutRefreshFrames(options = {}) {
            const frames = originalRefreshFrames.call(this, options) || [];
            markParagraphStarts(frames);
            this.playback?.setFrames?.(frames, { preserveIdentity: options.preserveIdentity !== false });
            this.updateControls?.();
            return frames;
        };

        const originalRenderFrame = Controller.prototype.renderFrame;
        Controller.prototype.renderFrame = function paragraphLayoutRenderFrame(frame, target) {
            const result = originalRenderFrame.call(this, frame, target);
            const rows = target?.querySelectorAll?.('.reader-playback-line') || [];
            (frame?.lines || []).forEach((line, index) => {
                const row = rows[index];
                if (!row) return;
                row.dataset.paragraphStart = line.paragraph_start ? '1' : '0';
            });
            return result;
        };

        Controller.prototype.__paragraphLayoutPolicyInstalled = true;
        return true;
    }

    return { PARAGRAPH_TYPES, install, lineIdentity, markParagraphStarts };
});