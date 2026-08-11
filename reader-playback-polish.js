(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderPlaybackPolish = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const WIDTH_INPUT_PX = 48;
    const FIRST_CONTROL_ID = 'speedReadingFirst';
    const LAST_CONTROL_ID = 'speedReadingLast';
    const ACTIVE_SESSION_STATES = new Set(['playing', 'paused', 'manual']);

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

    function isTrainingRunning(controller) {
        return controller?.trainingClock?.state === 'running' && !controller?.trainingPaused;
    }

    function isPlaybackSessionEngaged(controller) {
        if (typeof controller?.isPlaybackSessionEngaged === 'function') {
            return Boolean(controller.isPlaybackSessionEngaged());
        }
        const playbackState = controller?.playback?.state;
        if (!ACTIVE_SESSION_STATES.has(playbackState)) return false;
        const clock = controller?.trainingClock;
        if (!clock) return playbackState === 'playing';
        return clock.state === 'running' || clock.state === 'paused';
    }

    function upgradeToolbar(controller) {
        if (!controller?.document) return false;
        const toolbar = controller.element?.('speedReadingV2Toolbar');
        if (!toolbar || toolbar.classList?.contains?.('speed-reading-v2-toolbar-compat')) return false;

        const prev = controller.element?.('speedReadingPrev');
        const playPause = controller.element?.('speedReadingPause');
        const next = controller.element?.('speedReadingNext');
        const stop = controller.element?.('speedReadingStop');
        if (!prev || !playPause || !next || !stop) return false;

        prev.textContent = '←';
        next.textContent = '→';
        stop.textContent = '⏹';
        stop.title = '停止';
        stop.setAttribute?.('aria-label', stop.title);

        let first = controller.element?.(FIRST_CONTROL_ID);
        if (!first) {
            first = createToolbarButton(controller, FIRST_CONTROL_ID, '⏮', '首页');
            if (first) {
                first.addEventListener?.('click', () => {
                    Promise.resolve(controller.firstFrame?.()).catch((error) => controller.reader?.renderError?.(error));
                });
                toolbar.insertBefore?.(first, prev);
            }
        }

        let last = controller.element?.(LAST_CONTROL_ID);
        if (!last) {
            last = createToolbarButton(controller, LAST_CONTROL_ID, '⏭', '尾页');
            if (last) {
                last.addEventListener?.('click', () => {
                    Promise.resolve(controller.lastFrame?.()).catch((error) => controller.reader?.renderError?.(error));
                });
                toolbar.insertBefore?.(last, stop);
            }
        }
        applyTransportLabels(controller);
        return Boolean(first && last);
    }

    function applyTransportLabels(controller) {
        const engaged = isPlaybackSessionEngaged(controller);
        const labels = engaged
            ? [
                [FIRST_CONTROL_ID, '到头（第一帧）'],
                ['speedReadingPrev', '上一帧'],
                ['speedReadingNext', '下一帧'],
                [LAST_CONTROL_ID, '到尾（最后一帧）'],
            ]
            : [
                [FIRST_CONTROL_ID, '首页'],
                ['speedReadingPrev', '上一页'],
                ['speedReadingNext', '下一页'],
                [LAST_CONTROL_ID, '尾页'],
            ];
        for (const [id, title] of labels) {
            const button = controller?.element?.(id);
            if (!button) continue;
            button.title = title;
            button.setAttribute?.('aria-label', title);
        }
        const hint = controller?.element?.('speedReadingV2Toolbar')?.querySelector?.('.speed-reading-v2-shortcuts');
        if (hint) {
            hint.textContent = engaged
                ? 'Space 播放/暂停 · ←/→ 上一帧/下一帧 · Home/End 第一帧/最后一帧 · Esc 停止'
                : '←/→ 上一页/下一页 · Home/End 首页/尾页 · Space 开始速度阅读';
        }
        return true;
    }

    function wrapUpdateControls(target) {
        if (!target || typeof target.updateControls !== 'function') return false;
        if (Object.prototype.hasOwnProperty.call(target, '__playbackPolishLabelsWrapped')) return false;
        const original = target.updateControls;
        target.updateControls = function updateControlsWithLabels(...args) {
            const result = original.apply(this, args);
            applyTransportLabels(this);
            return result;
        };
        Object.defineProperty(target, '__playbackPolishLabelsWrapped', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const PlaybackUI = rootObject?.ReaderSpeedPlaybackUI;
        const Controller = PlaybackUI?.ReaderSpeedPlaybackUIController;
        if (!Controller || Controller.prototype.__playbackPolishInstalled) return false;

        const originalRenderManualFrame = Controller.prototype.renderManualFrame;
        if (typeof originalRenderManualFrame === 'function') {
            Controller.prototype.renderManualFrame = function renderManualFrameWithSessionLabels(frame, target) {
                originalRenderManualFrame.call(this, frame, target);
                const button = target?.querySelector?.('.reader-playback-continue');
                const isLast = this.playback?.index >= (this.playback?.frames?.length || 0) - 1;
                if (!button) return;
                if (isLast) {
                    button.textContent = '最后一帧 · 返回阅读视图';
                    button.onclick = (event) => {
                        event?.stopPropagation?.();
                        this.stop();
                    };
                } else {
                    button.textContent = isTrainingRunning(this) ? '继续' : '下一帧';
                }
            };
        }

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
                upgradeToolbar(this);
                widenWidthInput(this);
                applyTransportLabels(this);
                return result;
            };
        }

        wrapUpdateControls(Controller.prototype);
        Controller.prototype.__playbackPolishInstalled = true;

        const controller = PlaybackUI?.getDefaultController?.();
        if (controller) {
            wrapUpdateControls(controller);
            upgradeToolbar(controller);
            widenWidthInput(controller);
            applyTransportLabels(controller);
            controller.updateControls?.();
        }
        return true;
    }

    return {
        ACTIVE_SESSION_STATES,
        FIRST_CONTROL_ID,
        LAST_CONTROL_ID,
        WIDTH_INPUT_PX,
        applyTransportLabels,
        createToolbarButton,
        install,
        isPlaybackSessionEngaged,
        isTrainingRunning,
        upgradeToolbar,
        widenWidthInput,
        wrapUpdateControls,
    };
});