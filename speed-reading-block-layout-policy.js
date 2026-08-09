(function (root, factory) {
    const api = factory(root && root.SpeedReadingResponsiveLayout);
    const isCommonJs = typeof module === 'object' && module.exports;
    if (isCommonJs) module.exports = api;
    if (root) {
        root.SpeedReadingBlockLayoutPolicy = api;
        if (!isCommonJs && typeof root.setTimeout === 'function') {
            root.setTimeout(() => api.installWithRetry(root), 0);
        }
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ResponsiveLayout) {
    'use strict';

    const INSTALL_RETRY_MS = 20;
    const INSTALL_RETRY_LIMIT = 250;

    function normalizeReadingMode(value) {
        return String(value || '').trim().toLowerCase() === 'moving' ? 'moving' : 'focus';
    }

    function fixedBlockFrameWidth(frame, contentWidthPx) {
        const measured = Number(frame?.lines?.[0]?.measured_width_px);
        const fallback = Number(frame?.placement?.width_px || frame?.placement?.line_width_px);
        const width = Number.isFinite(measured) && measured > 0 ? measured : fallback;
        return Math.max(1, Math.min(Math.max(1, Number(contentWidthPx) || 1), Number(width) || 1));
    }

    function convertLineBuildToFixedBlocks(built, options = {}) {
        if (!built) return built;
        const contentWidthPx = Math.max(
            1,
            Number(built.options?.maxWidthPx) || Number(options.maxWidthPx) || 1,
        );
        const blockWidthPx = Math.max(
            1,
            Number(built.options?.lineWidthPx)
                || (contentWidthPx * Number(options.widthPercent || 100) / 100),
        );

        for (const frame of built.frames || []) {
            if (frame?.kind !== 'timed_text' || !frame?.placement) continue;
            const frameWidthPx = fixedBlockFrameWidth(frame, contentWidthPx);
            const structuralSingleRow = Boolean(frame?.lines?.[0]?.structural_single_row);
            frame.placement = {
                ...frame.placement,
                display_scope: 'block',
                x_px: Math.max(0, (contentWidthPx - frameWidthPx) / 2),
                width_px: frameWidthPx,
                block_width_px: blockWidthPx,
                line_width_px: blockWidthPx,
                block_index: 0,
                block_count: 1,
                structural_single_row: structuralSingleRow,
                fixed_block_reflow: true,
            };
        }

        built.options = {
            ...(built.options || {}),
            displayScope: 'block',
            readingMode: 'focus',
            blockWidthPx,
            lineWidthPx: blockWidthPx,
        };
        return built;
    }

    function buildBlockAwarePlaybackFrames(originalBuild, responsive, adapter, documentView, nodes, options = {}) {
        const displayScope = ['block', 'line', 'page'].includes(options.displayScope)
            ? options.displayScope
            : 'line';
        const readingMode = normalizeReadingMode(options.readingMode);
        if (displayScope !== 'block' || readingMode === 'moving') {
            return originalBuild.call(responsive, adapter, documentView, nodes, options);
        }

        // Fixed-viewpoint Block is a continuous reflow stream. Reuse the measured
        // one-line layout at the configured block width so a soft visual-line tail
        // never creates an artificial short block. Structural rows remain atomic.
        const built = originalBuild.call(responsive, adapter, documentView, nodes, {
            ...options,
            displayScope: 'line',
            lineCount: 1,
            maxLines: 1,
        });
        return convertLineBuildToFixedBlocks(built, options);
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const responsive = rootObject?.SpeedReadingResponsiveLayout || ResponsiveLayout;
        const PlaybackUI = rootObject?.ReaderSpeedPlaybackUI;
        const Controller = PlaybackUI?.ReaderSpeedPlaybackUIController;
        const prototype = Controller?.prototype;
        if (
            !responsive?.buildMeasuredPlaybackFrames
            || !prototype?.__speedReadingLayoutIntegrityInstalled
        ) return false;

        if (!responsive.__blockViewpointBuildWrapped) {
            const originalBuild = responsive.buildMeasuredPlaybackFrames;
            responsive.buildMeasuredPlaybackFrames = function blockViewpointAwareBuild(
                adapter,
                documentView,
                nodes,
                options = {},
            ) {
                return buildBlockAwarePlaybackFrames(
                    originalBuild,
                    responsive,
                    adapter,
                    documentView,
                    nodes,
                    options,
                );
            };
            responsive.__blockViewpointBuildWrapped = true;
        }

        if (!prototype.__blockViewpointAdapterOptionsWrapped) {
            const originalAdapterOptions = prototype.adapterOptions;
            if (typeof originalAdapterOptions !== 'function') return false;
            prototype.adapterOptions = function blockViewpointAdapterOptions() {
                return {
                    ...originalAdapterOptions.call(this),
                    readingMode: normalizeReadingMode(this.readingMode?.()),
                };
            };
            prototype.__blockViewpointAdapterOptionsWrapped = true;
        }

        if (!prototype.__blockViewpointSettingRefreshWrapped) {
            const originalOnSettingChanged = prototype.onSettingChanged;
            if (typeof originalOnSettingChanged !== 'function') return false;
            prototype.onSettingChanged = function blockViewpointSettingChanged(options = {}) {
                const readingMode = normalizeReadingMode(this.readingMode?.());
                const displayScope = this.displayScope?.() || 'line';
                const modeChanged = readingMode !== this.__blockViewpointLastReadingMode;
                this.__blockViewpointLastReadingMode = readingMode;
                if (displayScope === 'block' && modeChanged && options.frames === false) {
                    return originalOnSettingChanged.call(this, { ...options, frames: true });
                }
                return originalOnSettingChanged.call(this, options);
            };
            prototype.__blockViewpointSettingRefreshWrapped = true;
        }

        const controller = PlaybackUI?.getDefaultController?.();
        if (controller && !controller.__blockViewpointLastReadingMode) {
            controller.__blockViewpointLastReadingMode = normalizeReadingMode(controller.readingMode?.());
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
        INSTALL_RETRY_LIMIT,
        INSTALL_RETRY_MS,
        buildBlockAwarePlaybackFrames,
        convertLineBuildToFixedBlocks,
        fixedBlockFrameWidth,
        install,
        installWithRetry,
        normalizeReadingMode,
    };
});