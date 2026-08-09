(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderPlaybackPolish = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const WIDTH_INPUT_PX = 48;
    const FIRST_CONTROL_ID = 'speedReadingFirst';
    const LAST_CONTROL_ID = 'speedReadingLast';

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

    function widenWidthInput(controller) {
        const input = controller?.element?.('widthInput');
        if (!input?.style) return false;
        input.style.width = `${WIDTH_INPUT_PX}px`;
        input.style.maxWidth = `${WIDTH_INPUT_PX}px`;
        input.style.minWidth = `${WIDTH_INPUT_PX}px`;
        input.style.flexShrink = '0';
        return true;
    }

    function createToolbarButton(controller, id, text, title) {
        const button = controller?.document?.createElement?.('button');
        if (!button) return null;
        button.id = id;
        button.type = 'button';
        button.textContent = text;
        button.title = title;
        button.disabled = true;
        button.setAttribute?.('aria-label', title);
        return button;
    }

    function moveToBoundary(controller, toEnd = false) {
        const snapshot = controller?.playback?.snapshot?.();
        if (!controller?.isReaderActive?.() || !snapshot?.frame_count) return null;
        const destination = toEnd ? snapshot.frame_count - 1 : 0;
        const delta = destination - snapshot.index;
        if (typeof controller.playback?.moveBy === 'function') return controller.playback.moveBy(delta);
        return controller.playback?.seek?.(toEnd ? 1 : 0) || null;
    }

    function upgradeToolbar(controller) {
        if (!controller?.document) return false;
        controller.ensureToolbar?.();
        const toolbar = controller.element?.('speedReadingV2Toolbar');
        if (!toolbar || toolbar.classList?.contains?.('speed-reading-v2-toolbar-compat')) return false;

        const prev = controller.element?.('speedReadingPrev');
        const playPause = controller.element?.('speedReadingPause');
        const next = controller.element?.('speedReadingNext');
        const stop = controller.element?.('speedReadingStop');
        if (!prev || !playPause || !next || !stop) return false;

        prev.textContent = '←';
        prev.title = '上一帧';
        prev.setAttribute?.('aria-label', prev.title);
        next.textContent = '→';
        next.title = '下一帧';
        next.setAttribute?.('aria-label', next.title);
        stop.textContent = '⏹';
        stop.title = '停止';
        stop.setAttribute?.('aria-label', stop.title);

        let first = controller.element?.(FIRST_CONTROL_ID);
        if (!first) {
            first = createToolbarButton(controller, FIRST_CONTROL_ID, '⏮', '到头（第一帧）');
            if (first) {
                first.addEventListener?.('click', () => controller.firstFrame?.());
                toolbar.insertBefore?.(first, prev);
            }
        }

        let last = controller.element?.(LAST_CONTROL_ID);
        if (!last) {
            last = createToolbarButton(controller, LAST_CONTROL_ID, '⏭', '到尾（最后一帧）');
            if (last) {
                last.addEventListener?.('click', () => controller.lastFrame?.());
                toolbar.insertBefore?.(last, stop);
            }
        }

        const hint = toolbar.querySelector?.('.speed-reading-v2-shortcuts');
        if (hint) hint.textContent = 'Space 播放/暂停 · ←/→ 上一帧/下一帧 · Home/End 到头/到尾 · Esc 停止';
        return Boolean(first && last);
    }

    function ensureTrainingClockRunning(controller) {
        const clock = controller?.trainingClock;
        if (!clock) return;
        if (clock.state === 'paused') clock.resume?.();
        else if (clock.state !== 'running') clock.start?.();
        controller.startTrainingTicker?.();
    }

    function playPause(controller) {
        if (!controller?.isReaderActive?.() || !(controller.playback?.frames || []).length) return false;
        const state = controller.playback.state;

        if (state === 'idle' || state === 'completed') {
            if (state === 'completed') controller.playback.stop?.();
            Promise.resolve(controller.start?.()).catch((error) => controller.reader?.renderError?.(error));
            return true;
        }

        if (state === 'playing') return controller.toggleTrainingPause?.() || false;

        if (state === 'paused') {
            if (controller.trainingPaused) return controller.toggleTrainingPause?.() || false;
            controller.comprehensionPaused = false;
            controller.resumePlaybackAfterTrainingPause = false;
            ensureTrainingClockRunning(controller);
            return controller.playback.resume?.() || false;
        }

        if (state === 'manual') {
            if (controller.trainingPaused) return controller.toggleTrainingPause?.() || false;
            return controller.continueManual?.() || false;
        }
        return false;
    }

    function applyPlaybackControlState(controller, snapshot = controller?.playback?.snapshot?.()) {
        if (!controller || !snapshot) return false;
        const playable = Boolean(controller.isReaderActive?.() && snapshot.frame_count > 0);
        const playing = snapshot.state === 'playing';
        const atFirst = !snapshot.frame_count || snapshot.index <= 0;
        const atLast = !snapshot.frame_count || snapshot.index >= snapshot.frame_count - 1;

        const toggle = controller.element?.('readingToggleBtn');
        if (toggle) {
            toggle.disabled = !playable;
            toggle.textContent = playing ? '⏸' : '▶';
            toggle.title = playing ? '暂停速度阅读' : '播放速度阅读';
            toggle.setAttribute?.('aria-label', toggle.title);
            toggle.classList?.toggle?.('active', playing);
        }

        const hiddenPlayPause = controller.element?.('speedReadingPause');
        if (hiddenPlayPause) {
            hiddenPlayPause.disabled = !playable;
            hiddenPlayPause.textContent = playing ? '⏸' : '▶';
            hiddenPlayPause.title = playing ? '暂停速度阅读' : (snapshot.state === 'manual' ? '继续当前手动帧' : '播放速度阅读');
            hiddenPlayPause.setAttribute?.('aria-label', hiddenPlayPause.title);
        }

        const first = controller.element?.(FIRST_CONTROL_ID);
        const prev = controller.element?.('speedReadingPrev');
        const next = controller.element?.('speedReadingNext');
        const last = controller.element?.(LAST_CONTROL_ID);
        if (first) first.disabled = !playable || atFirst;
        if (prev) prev.disabled = !playable || atFirst;
        if (next) next.disabled = !playable || atLast;
        if (last) last.disabled = !playable || atLast;
        return true;
    }

    function bindReadingToggleCapture(controller) {
        const documentObject = controller?.document;
        if (!documentObject?.addEventListener || controller.__readingTogglePlayPauseCaptureBound) return false;
        controller.__readingTogglePlayPauseCaptureBound = true;
        documentObject.addEventListener('click', (event) => {
            const target = event?.target;
            const toggle = target?.id === 'readingToggleBtn'
                ? target
                : target?.closest?.('#readingToggleBtn');
            if (!toggle || !controller.isReaderActive?.()) return;
            event.preventDefault?.();
            event.stopPropagation?.();
            event.stopImmediatePropagation?.();
            controller.togglePause?.();
        }, true);
        return true;
    }

    function wrapUpdateControls(target) {
        if (!target || target.__playbackControlStateWrapped || typeof target.updateControls !== 'function') return false;
        const original = target.updateControls;
        target.updateControls = function updateControlsWithPlaybackTruth(...args) {
            const result = original.apply(this, args);
            const snapshot = args[0] || this.playback?.snapshot?.();
            applyPlaybackControlState(this, snapshot);
            return result;
        };
        target.__playbackControlStateWrapped = true;
        return true;
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

        Controller.prototype.firstFrame = function firstPlaybackFrame() {
            return moveToBoundary(this, false);
        };
        Controller.prototype.lastFrame = function lastPlaybackFrame() {
            return moveToBoundary(this, true);
        };
        Controller.prototype.togglePause = function togglePlaybackPlayPause() {
            return playPause(this);
        };

        const originalEnsureToolbar = Controller.prototype.ensureToolbar;
        if (typeof originalEnsureToolbar === 'function') {
            Controller.prototype.ensureToolbar = function ensureCompletePlaybackToolbar(...args) {
                const result = originalEnsureToolbar.apply(this, args);
                upgradeToolbar(this);
                return result;
            };
        }

        const originalSettingsVisibility = Controller.prototype.updateSettingsVisibility;
        if (typeof originalSettingsVisibility === 'function') {
            Controller.prototype.updateSettingsVisibility = function settingsWithReadableWidthInput(...args) {
                const result = originalSettingsVisibility.apply(this, args);
                widenWidthInput(this);
                return result;
            };
        }

        const originalBind = Controller.prototype.bind;
        if (typeof originalBind === 'function') {
            Controller.prototype.bind = function bindPlaybackPolish(...args) {
                const result = originalBind.apply(this, args);
                bindReadingToggleCapture(this);
                upgradeToolbar(this);
                widenWidthInput(this);
                applyPlaybackControlState(this);
                return result;
            };
        }

        const originalKeyDown = Controller.prototype.onKeyDown;
        if (typeof originalKeyDown === 'function') {
            Controller.prototype.onKeyDown = function playbackBoundaryKeys(event) {
                if (this.isReaderActive?.() && !this.isEditableTarget?.(event?.target)) {
                    if (event?.key === 'Home') {
                        event.preventDefault?.();
                        return this.firstFrame();
                    }
                    if (event?.key === 'End') {
                        event.preventDefault?.();
                        return this.lastFrame();
                    }
                }
                return originalKeyDown.call(this, event);
            };
        }

        wrapUpdateControls(Controller.prototype);
        Controller.prototype.__playbackPolishInstalled = true;

        const controller = PlaybackUI?.getDefaultController?.();
        if (controller) {
            wrapUpdateControls(controller);
            bindReadingToggleCapture(controller);
            upgradeToolbar(controller);
            widenWidthInput(controller);
            applyPlaybackControlState(controller);
        }
        return true;
    }

    return {
        FIRST_CONTROL_ID,
        LAST_CONTROL_ID,
        WIDTH_INPUT_PX,
        applyPlaybackControlState,
        bindReadingToggleCapture,
        createToolbarButton,
        ensureTrainingClockRunning,
        install,
        moveToBoundary,
        playPause,
        resolveResumeIndex,
        upgradeToolbar,
        widenWidthInput,
        wrapUpdateControls,
    };
});