(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderPlaybackPolish = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function resolveResumeIndex(controller) {
        const record = controller?.reader?.resumeRecord;
        const frames = controller?.playback?.frames || [];
        if ((!record?.frame_id && record?.frame_ordinal == null) || !frames.length) return -1;
        let index = record.frame_id ? frames.findIndex((frame) => frame.frame_id === record.frame_id) : -1;
        if (index < 0 && record.node_id) {
            index = frames.findIndex((frame) => frame?.identity?.node_id === record.node_id
                && (record.frame_ordinal == null || frame.frame_ordinal === record.frame_ordinal));
        }
        return index;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const PlaybackUI = rootObject?.ReaderSpeedPlaybackUI;
        const Controller = PlaybackUI?.ReaderSpeedPlaybackUIController;
        if (!Controller || Controller.prototype.__playbackPolishInstalled) return false;

        Controller.prototype.restoreResumeFrame = function deferResumeFrame() {
            const index = resolveResumeIndex(this);
            this.pendingResumeFrameIndex = index >= 0 ? index : null;
            return index >= 0;
        };

        const originalStart = Controller.prototype.start;
        Controller.prototype.start = async function startWithDeferredResume() {
            const pending = this.pendingResumeFrameIndex;
            if (Number.isInteger(pending) && pending >= 0) {
                const originalPlay = this.playback.play.bind(this.playback);
                this.playback.play = () => {
                    this.playback.index = Math.min(pending, Math.max(0, this.playback.frames.length - 1));
                    this.pendingResumeFrameIndex = null;
                    this.playback.play = originalPlay;
                    return originalPlay();
                };
            }
            return originalStart.call(this);
        };

        const originalRenderManualFrame = Controller.prototype.renderManualFrame;
        Controller.prototype.renderManualFrame = function renderManualFrameWithTerminalState(frame, target) {
            originalRenderManualFrame.call(this, frame, target);
            const button = target?.querySelector?.('.reader-playback-continue');
            const isLast = this.playback?.index >= (this.playback?.frames?.length || 0) - 1;
            if (button && isLast) {
                button.textContent = '最后一帧 · 返回阅读视图';
                button.onclick = (event) => {
                    event?.stopPropagation?.();
                    this.stop();
                };
            }
        };

        Controller.prototype.__playbackPolishInstalled = true;
        return true;
    }

    return { install, resolveResumeIndex };
});