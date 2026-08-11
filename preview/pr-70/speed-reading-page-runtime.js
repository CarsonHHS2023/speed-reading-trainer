(function (root, factory) {
    const api = factory(
        root && root.SpeedReadingResponsiveLayout,
        root && root.SpeedReadingAdapter,
    );
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.SpeedReadingPageRuntime = api;
        if (typeof root.setTimeout === 'function') root.setTimeout(() => api.install(root), 0);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ResponsiveLayout, Adapter) {
    'use strict';

    function numericLineHeight(computed, fallbackFontSize) {
        const parsed = Number.parseFloat(computed?.lineHeight);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
        const fontSize = Math.max(1, Number.parseFloat(computed?.fontSize) || Number(fallbackFontSize) || 28);
        return fontSize * Number(ResponsiveLayout?.DEFAULT_LINE_HEIGHT_RATIO || 1.55);
    }

    function pageContext(controller) {
        return controller?.playbackContext?.()
            || controller?.reader?.playbackBatchForCurrentPage?.()
            || null;
    }

    function buildMeasuredPageFrames(controller, layout, adapter, options = {}) {
        if (!controller?.reader?.openResponse) {
            controller?.playback?.setFrames?.([], { preserveIdentity: false });
            controller?.updateControls?.();
            return [];
        }

        const context = pageContext(controller);
        if (!context?.nodes?.length) {
            controller.playback.setFrames([], { preserveIdentity: false });
            controller.updateControls?.();
            return [];
        }

        controller.updateSettingsVisibility?.();
        controller.applyVisualSettings?.();
        const settings = controller.adapterOptions?.() || {};
        const target = controller.element?.('pageText');
        const view = controller.document?.defaultView;
        const computed = target && view?.getComputedStyle ? view.getComputedStyle(target) : null;
        const measureText = layout.createCanvasMeasurer(controller.document, {
            fontFamily: computed?.fontFamily,
            fontSize: computed?.fontSize,
            fontStyle: computed?.fontStyle,
            fontWeight: computed?.fontWeight,
        });
        const lineHeightPx = numericLineHeight(computed, controller.element?.('fontInput')?.value || 28);
        const availableHeight = controller.playbackAvailableHeight?.() || 1;
        const capacity = layout.pageLineCapacity(availableHeight, lineHeightPx, 0);
        const pageBudgetPx = layout.pageHeightBudget(availableHeight, 0, lineHeightPx);
        const built = layout.buildMeasuredPlaybackFrames(adapter, controller.reader.openResponse, context.nodes, {
            ...settings,
            displayScope: 'page',
            maxWidthPx: Math.max(1, Number(settings.maxWidthPx) || 1),
            pageLineCapacity: capacity,
            pageHeightPx: pageBudgetPx,
            fontSizePx: Math.max(1, Number.parseFloat(computed?.fontSize) || Number(settings.fontSizePx) || 28),
            lineHeightPx,
            measureText,
        });
        controller.playback.setFrames(built.frames, { preserveIdentity: options.preserveIdentity !== false });
        controller.updateControls?.();
        return built.frames;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const PlaybackUI = rootObject?.ReaderSpeedPlaybackUI;
        const Controller = PlaybackUI?.ReaderSpeedPlaybackUIController;
        const layout = rootObject?.SpeedReadingResponsiveLayout || ResponsiveLayout;
        const adapter = rootObject?.SpeedReadingAdapter || Adapter;
        if (!Controller || !layout || !adapter || Controller.prototype.__pageRuntimeInstalled) return false;

        const originalRefreshFrames = Controller.prototype.refreshFrames;
        const originalStart = Controller.prototype.start;

        Controller.prototype.refreshFrames = function pageRuntimeRefreshFrames(options = {}) {
            if (this.displayScope?.() !== 'page') return originalRefreshFrames.call(this, options);
            return buildMeasuredPageFrames(this, layout, adapter, options);
        };

        Controller.prototype.start = async function pageRuntimeStart() {
            if (this.displayScope?.() !== 'page') return originalStart.call(this);
            if (!this.isReaderActive?.()) return false;

            const context = this.reader?.playbackBatchForCurrentPage?.();
            if (!context?.nodes?.length) return false;
            this.activeBatchStart = context.start;

            const frames = this.refreshFrames({ preserveIdentity: false }) || [];
            const startIndex = this.frameIndexForNode?.(context.firstNodeId, frames) ?? -1;
            if (startIndex > 0 && frames.length && typeof this.playback?.seek === 'function') {
                this.playback.seek(startIndex / frames.length, { activate: false });
            }

            this.applyVisualSettings?.();
            this.beginTrainingSession?.();
            const started = this.playback?.play?.() || false;
            if (!started) {
                this.trainingClock?.stop?.();
                this.stopTrainingTicker?.();
                this.activeBatchStart = null;
            }
            this.updateControls?.();
            return started;
        };

        Controller.prototype.__pageRuntimeInstalled = true;
        return true;
    }

    return {
        buildMeasuredPageFrames,
        install,
        numericLineHeight,
        pageContext,
    };
});
