(function (root, factory) {
    const api = factory(
        root && root.SpeedReadingAdapter,
        root && root.SpeedReadingResponsiveLayout,
    );
    const isCommonJs = typeof module === 'object' && module.exports;
    if (isCommonJs) module.exports = api;
    if (root) {
        root.SpeedReadingSpeedPolicy = api;
        if (!isCommonJs && root.document && typeof root.setTimeout === 'function') {
            root.setTimeout(() => api.installWithRetry(root), 0);
        }
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Adapter, ResponsiveLayout) {
    'use strict';

    const MIN_SPEED_PER_MINUTE = 100;
    const DEFAULT_SPEED_PER_MINUTE = 5000;
    const FALLBACK_MIN_FRAME_DURATION_MS = 1000 / 6;
    const INSTALL_RETRY_MS = 20;
    const INSTALL_RETRY_LIMIT = 250;
    const SPEED_UNIT_LABEL = '字/分钟';
    const VIEWPOINT_MODE_LABEL = '视点模式：';
    const FIXED_VIEWPOINT_LABEL = '固定式';
    const MOVING_VIEWPOINT_LABEL = '移动式';

    function clampWidthPercent(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 100;
        return Math.max(20, Math.min(100, numeric));
    }

    function numericLineHeight(computed, fallbackFontSize, ratio = 1.55) {
        const parsed = Number.parseFloat(computed?.lineHeight);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
        const fontSize = Math.max(1, Number.parseFloat(computed?.fontSize) || Number(fallbackFontSize) || 28);
        return fontSize * Math.max(1, Number(ratio) || 1.55);
    }

    function frameLineCapacity(displayScope, lineCount, pageLineCapacity) {
        const scope = ['block', 'line', 'page'].includes(displayScope) ? displayScope : 'line';
        const configuredLines = Math.max(1, Math.floor(Number(lineCount) || 1));
        const pageCapacity = Math.max(1, Math.floor(Number(pageLineCapacity) || configuredLines));
        if (scope === 'block') return 1;
        if (scope === 'page') return pageCapacity;
        return Math.min(configuredLines, pageCapacity);
    }

    function maximumSpeedPerMinute(options = {}, adapter = Adapter) {
        const displayScope = ['block', 'line', 'page'].includes(options.displayScope)
            ? options.displayScope
            : 'line';
        const maxWidthPx = Math.max(1, Number(options.maxWidthPx) || 1);
        const widthPercent = clampWidthPercent(options.widthPercent);
        const configuredWidthPx = Math.max(1, maxWidthPx * widthPercent / 100);
        const fallbackGlyphWidth = Math.max(1, Number(options.fontSizePx) || 28);
        const measuredGlyphWidth = typeof options.measureText === 'function'
            ? Number(options.measureText('汉', 'paragraph'))
            : 0;
        const glyphWidthPx = Math.max(1, measuredGlyphWidth || fallbackGlyphWidth);
        const charactersPerLine = Math.max(1, Math.floor(configuredWidthPx / glyphWidthPx));
        const linesPerFrame = frameLineCapacity(
            displayScope,
            options.lineCount,
            options.pageLineCapacity,
        );
        const readingUnitsPerFrame = charactersPerLine * linesPerFrame;
        const minFrameDurationMs = Math.max(
            1,
            Number(options.minFrameDurationMs)
                || Number(adapter?.MIN_FRAME_DURATION_MS)
                || FALLBACK_MIN_FRAME_DURATION_MS,
        );
        const maxSpeed = Math.floor((readingUnitsPerFrame * 60000) / minFrameDurationMs + 1e-9);
        return Math.max(MIN_SPEED_PER_MINUTE, maxSpeed);
    }

    function configureSettingsLabels(controller) {
        const speedUnit = controller?.element?.('speedUnit');
        if (speedUnit) speedUnit.textContent = SPEED_UNIT_LABEL;

        const mode = controller?.element?.('trainingMode');
        if (mode) {
            for (const option of Array.from(mode.options || [])) {
                if (option.value === 'focus' || option.value === 'fixed') option.textContent = FIXED_VIEWPOINT_LABEL;
                else if (option.value === 'moving' || option.value === 'scroll') option.textContent = MOVING_VIEWPOINT_LABEL;
            }
            const label = mode.closest?.('.setting-grid-cell')?.querySelector?.('label')
                || controller.document?.querySelector?.('label[for="trainingMode"]');
            if (label) label.textContent = VIEWPOINT_MODE_LABEL;
        }

        const speedInput = controller?.element?.('speedInput');
        if (speedInput?.style) {
            speedInput.style.width = '72px';
            speedInput.style.maxWidth = '72px';
        }
    }

    function applySpeedRangeControls(controller, maxSpeedPerMinute) {
        const slider = controller?.element?.('speedSlider');
        const input = controller?.element?.('speedInput');
        const minCandidate = Number(input?.min || slider?.min || MIN_SPEED_PER_MINUTE);
        const minSpeed = Math.max(1, Number.isFinite(minCandidate) ? minCandidate : MIN_SPEED_PER_MINUTE);
        const maxSpeed = Math.max(minSpeed, Math.floor(Number(maxSpeedPerMinute) || minSpeed));
        const currentCandidate = Number(input?.value || slider?.value || DEFAULT_SPEED_PER_MINUTE);
        const currentSpeed = Number.isFinite(currentCandidate) && currentCandidate > 0
            ? currentCandidate
            : DEFAULT_SPEED_PER_MINUTE;
        const effectiveSpeed = Math.max(minSpeed, Math.min(maxSpeed, Math.round(currentSpeed)));

        for (const control of [slider, input]) {
            if (!control) continue;
            control.min = String(minSpeed);
            control.max = String(maxSpeed);
            control.value = String(effectiveSpeed);
        }
        configureSettingsLabels(controller);
        return {
            minSpeedPerMinute: minSpeed,
            maxSpeedPerMinute: maxSpeed,
            speedPerMinute: effectiveSpeed,
        };
    }

    function speedLayoutContext(controller, rootObject) {
        const responsive = rootObject?.SpeedReadingResponsiveLayout || ResponsiveLayout;
        const adapter = rootObject?.SpeedReadingAdapter || Adapter;
        if (!controller || !responsive) return null;

        controller.updateSettingsVisibility?.();
        controller.applyVisualSettings?.();
        const settings = controller.adapterOptions?.() || {};
        const displayScope = controller.displayScope?.() || settings.displayScope || 'line';
        const target = displayScope === 'page'
            ? controller.element?.('pageText')
            : controller.element?.('focusText');
        const view = controller.document?.defaultView || rootObject;
        const computed = target && view?.getComputedStyle ? view.getComputedStyle(target) : null;
        const fontSizePx = Math.max(
            1,
            Number.parseFloat(computed?.fontSize)
                || Number(controller.element?.('fontInput')?.value)
                || 28,
        );
        const measureText = responsive.createCanvasMeasurer?.(controller.document, {
            fontFamily: computed?.fontFamily,
            fontSize: computed?.fontSize || `${fontSizePx}px`,
            fontStyle: computed?.fontStyle,
            fontWeight: computed?.fontWeight,
        });
        const lineHeightPx = numericLineHeight(
            computed,
            fontSizePx,
            responsive.DEFAULT_LINE_HEIGHT_RATIO,
        );
        const pageLineCapacity = responsive.pageLineCapacity?.(
            controller.playbackAvailableHeight?.(),
            lineHeightPx,
            responsive.DEFAULT_SAFE_VERTICAL_GUTTER_PX,
        ) || Math.max(1, Number(settings.lineCount || settings.maxLines) || 1);

        const maximum = maximumSpeedPerMinute({
            displayScope,
            widthPercent: settings.widthPercent,
            maxWidthPx: settings.maxWidthPx,
            lineCount: settings.lineCount || settings.maxLines,
            pageLineCapacity,
            measureText,
            fontSizePx,
            minFrameDurationMs: adapter?.MIN_FRAME_DURATION_MS,
        }, adapter);
        return {
            maximum,
            displayScope,
            pageLineCapacity,
            lineHeightPx,
            fontSizePx,
        };
    }

    function updateSpeedLimit(controller, rootObject) {
        configureSettingsLabels(controller);
        const context = speedLayoutContext(controller, rootObject);
        if (!context) return null;
        const controls = applySpeedRangeControls(controller, context.maximum);
        return { ...context, ...controls };
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const Controller = rootObject?.ReaderSpeedPlaybackUI?.ReaderSpeedPlaybackUIController;
        const prototype = Controller?.prototype;
        if (!prototype || !prototype.__speedReadingLayoutIntegrityInstalled) return false;
        if (prototype.__speedReadingSpeedPolicyInstalled) return true;
        const originalRefreshFrames = prototype.refreshFrames;
        if (typeof originalRefreshFrames !== 'function') return false;

        prototype.refreshFrames = function refreshFramesWithDynamicSpeedLimit(options = {}) {
            updateSpeedLimit(this, rootObject);
            return originalRefreshFrames.call(this, options);
        };
        prototype.__speedReadingSpeedPolicyInstalled = true;

        const controller = rootObject?.ReaderSpeedPlaybackUI?.getDefaultController?.();
        if (controller) updateSpeedLimit(controller, rootObject);
        return true;
    }

    function installWithRetry(rootObject = typeof globalThis !== 'undefined' ? globalThis : null, attempt = 0) {
        if (install(rootObject)) return true;
        if (!rootObject || attempt >= INSTALL_RETRY_LIMIT || typeof rootObject.setTimeout !== 'function') return false;
        rootObject.setTimeout(() => installWithRetry(rootObject, attempt + 1), INSTALL_RETRY_MS);
        return false;
    }

    return {
        DEFAULT_SPEED_PER_MINUTE,
        FALLBACK_MIN_FRAME_DURATION_MS,
        FIXED_VIEWPOINT_LABEL,
        INSTALL_RETRY_LIMIT,
        INSTALL_RETRY_MS,
        MIN_SPEED_PER_MINUTE,
        MOVING_VIEWPOINT_LABEL,
        SPEED_UNIT_LABEL,
        VIEWPOINT_MODE_LABEL,
        applySpeedRangeControls,
        configureSettingsLabels,
        frameLineCapacity,
        install,
        installWithRetry,
        maximumSpeedPerMinute,
        numericLineHeight,
        speedLayoutContext,
        updateSpeedLimit,
    };
});