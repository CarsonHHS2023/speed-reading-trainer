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
    const DEFAULT_MEASURE_RESERVE_PX = 48;
    const FONT_MEASURE_RESERVE_RATIO = 1.5;
    const WRAPPABLE_STRUCTURE_TYPES = Object.freeze(['list', 'list_item']);
    const LAYOUT_SETTING_PAIRS = Object.freeze({
        speedSlider: 'speedInput',
        speedInput: 'speedSlider',
        widthSlider: 'widthInput',
        widthInput: 'widthSlider',
        linesSlider: 'linesInput',
        linesInput: 'linesSlider',
        fontSlider: 'fontInput',
        fontInput: 'fontSlider',
    });
    const LAYOUT_SPEED_CONTROL_IDS = Object.freeze([
        'speedSlider', 'speedInput',
        'widthSlider', 'widthInput',
        'linesSlider', 'linesInput',
        'fontSlider', 'fontInput', 'fontWeight',
        'displayMode',
    ]);

    function clampWidthPercent(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 100;
        return Math.max(20, Math.min(100, numeric));
    }

    function measureReservePx(options = {}) {
        const fontSizePx = Math.max(0, Number(options?.fontSizePx || options?.fontSize || 0) || 0);
        return Math.max(DEFAULT_MEASURE_RESERVE_PX, fontSizePx * FONT_MEASURE_RESERVE_RATIO);
    }

    function enableWrappedStructureRows(layout) {
        const singleRowTypes = layout?.SINGLE_ROW_TYPES;
        if (!singleRowTypes || typeof singleRowTypes.delete !== 'function') return false;
        for (const nodeType of WRAPPABLE_STRUCTURE_TYPES) singleRowTypes.delete(nodeType);
        return true;
    }

    function installMeasuredWidthGuard(prototype, responsive) {
        if (!prototype || prototype.__speedReadingMeasuredWidthGuardInstalled) return Boolean(prototype);
        const singleRowTypes = responsive?.SINGLE_ROW_TYPES;
        if (!singleRowTypes || typeof singleRowTypes.delete !== 'function') return false;
        const originalAdapterOptions = prototype.adapterOptions;
        if (typeof originalAdapterOptions !== 'function') return false;
        enableWrappedStructureRows(responsive);
        prototype.adapterOptions = function measuredWidthGuardAdapterOptions() {
            const options = originalAdapterOptions.call(this);
            const reserve = measureReservePx(options);
            return {
                ...options,
                maxWidthPx: Math.max(1, Number(options?.maxWidthPx || 1) - reserve),
                measurementReservePx: reserve,
            };
        };
        prototype.__speedReadingMeasuredWidthGuardInstalled = true;
        return true;
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
        const linesPerFrame = frameLineCapacity(displayScope, options.lineCount, options.pageLineCapacity);
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
        return { minSpeedPerMinute: minSpeed, maxSpeedPerMinute: maxSpeed, speedPerMinute: effectiveSpeed };
    }

    function speedLayoutContext(controller, rootObject) {
        const responsive = rootObject?.SpeedReadingResponsiveLayout || ResponsiveLayout;
        const adapter = rootObject?.SpeedReadingAdapter || Adapter;
        if (!controller || !responsive) return null;
        controller.updateSettingsVisibility?.();
        controller.applyVisualSettings?.();
        const settings = controller.adapterOptions?.() || {};
        const displayScope = controller.displayScope?.() || settings.displayScope || 'line';
        const target = displayScope === 'page' ? controller.element?.('pageText') : controller.element?.('focusText');
        const view = controller.document?.defaultView || rootObject;
        const computed = target && view?.getComputedStyle ? view.getComputedStyle(target) : null;
        const fontSizePx = Math.max(1, Number.parseFloat(computed?.fontSize) || Number(controller.element?.('fontInput')?.value) || 28);
        const measureText = responsive.createCanvasMeasurer?.(controller.document, {
            fontFamily: computed?.fontFamily,
            fontSize: computed?.fontSize || `${fontSizePx}px`,
            fontStyle: computed?.fontStyle,
            fontWeight: computed?.fontWeight,
        });
        const lineHeightPx = numericLineHeight(computed, fontSizePx, responsive.DEFAULT_LINE_HEIGHT_RATIO);
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
        return { maximum, displayScope, pageLineCapacity, lineHeightPx, fontSizePx };
    }

    function updateSpeedLimit(controller, rootObject) {
        configureSettingsLabels(controller);
        const context = speedLayoutContext(controller, rootObject);
        if (!context) return null;
        const controls = applySpeedRangeControls(controller, context.maximum);
        return { ...context, ...controls };
    }

    function syncPairedLayoutControl(controller, sourceId) {
        const pairedId = LAYOUT_SETTING_PAIRS[sourceId];
        if (!pairedId) return false;
        const source = controller?.element?.(sourceId);
        const paired = controller?.element?.(pairedId);
        if (!source || !paired) return false;
        paired.value = String(source.value ?? '');
        return true;
    }

    function bindDynamicSpeedControls(controller, rootObject) {
        if (!controller || controller.__speedReadingDynamicSpeedControlsBound) return false;
        controller.__speedReadingDynamicSpeedControlsBound = true;
        for (const id of LAYOUT_SPEED_CONTROL_IDS) {
            const control = controller.element?.(id);
            if (!control?.addEventListener) continue;
            const recalculate = () => {
                syncPairedLayoutControl(controller, id);
                updateSpeedLimit(controller, rootObject);
            };
            control.addEventListener('input', recalculate, true);
            control.addEventListener('change', recalculate, true);
        }
        return true;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const PlaybackUI = rootObject?.ReaderSpeedPlaybackUI;
        const Controller = PlaybackUI?.ReaderSpeedPlaybackUIController;
        const prototype = Controller?.prototype;
        const responsive = rootObject?.SpeedReadingResponsiveLayout || ResponsiveLayout;
        if (!prototype || !prototype.__speedReadingLayoutIntegrityInstalled) return false;

        installMeasuredWidthGuard(prototype, responsive);

        const originalBuildFrames = prototype.buildFrames;
        if (typeof originalBuildFrames === 'function' && !prototype.__speedReadingSpeedBuildDecoratorInstalled) {
            prototype.buildFrames = function buildFramesWithDynamicSpeedLimit(context) {
                updateSpeedLimit(this, rootObject);
                return originalBuildFrames.call(this, context);
            };
            prototype.__speedReadingSpeedBuildDecoratorInstalled = true;
        }
        prototype.__speedReadingSpeedPolicyInstalled = true;

        const controller = PlaybackUI?.getDefaultController?.();
        if (controller) {
            bindDynamicSpeedControls(controller, rootObject);
            updateSpeedLimit(controller, rootObject);
        }
        return true;
    }

    function installWithRetry(rootObject = typeof globalThis !== 'undefined' ? globalThis : null, attempt = 0) {
        if (install(rootObject)) return true;
        if (!rootObject || attempt >= INSTALL_RETRY_LIMIT || typeof rootObject.setTimeout !== 'function') return false;
        rootObject.setTimeout(() => installWithRetry(rootObject, attempt + 1), INSTALL_RETRY_MS);
        return false;
    }

    return {
        DEFAULT_MEASURE_RESERVE_PX, DEFAULT_SPEED_PER_MINUTE, FALLBACK_MIN_FRAME_DURATION_MS,
        FIXED_VIEWPOINT_LABEL, FONT_MEASURE_RESERVE_RATIO, INSTALL_RETRY_LIMIT, INSTALL_RETRY_MS,
        LAYOUT_SETTING_PAIRS, LAYOUT_SPEED_CONTROL_IDS, MIN_SPEED_PER_MINUTE, MOVING_VIEWPOINT_LABEL,
        SPEED_UNIT_LABEL, VIEWPOINT_MODE_LABEL, WRAPPABLE_STRUCTURE_TYPES, applySpeedRangeControls,
        bindDynamicSpeedControls, configureSettingsLabels, enableWrappedStructureRows, frameLineCapacity,
        install, installMeasuredWidthGuard, installWithRetry, maximumSpeedPerMinute, measureReservePx,
        numericLineHeight, speedLayoutContext, syncPairedLayoutControl, updateSpeedLimit,
    };
});