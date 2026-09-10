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

    function normalizeNodeType(value) {
        return String(value || '').trim().toLowerCase().replace(/[\s-]+/gu, '_');
    }

    function canonicalTocTitleNodeIds(nodes) {
        const ids = new Set();
        for (const node of nodes || []) {
            if (normalizeNodeType(node?.node_type) !== 'toc') continue;
            const nodeId = String(node?.node_id || '').trim();
            if (nodeId) ids.add(nodeId);
        }
        return ids;
    }

    function restoreCanonicalTocTitleTypography(built, nodes, measureText) {
        if (!built) return built;
        const tocTitleIds = canonicalTocTitleNodeIds(nodes);
        if (!tocTitleIds.size) return built;

        for (const frame of built.frames || []) {
            if (frame?.kind !== 'timed_text' || !Array.isArray(frame.lines)) continue;
            let promoted = false;
            for (const line of frame.lines) {
                const nodeId = String(line?.identity?.node_id || '').trim();
                if (!tocTitleIds.has(nodeId)) continue;
                line.node_type = 'title';
                line.structural_single_row = true;
                line.toc_title = true;
                if (typeof measureText === 'function') {
                    const measured = Number(measureText(line.text || '', 'title'));
                    if (Number.isFinite(measured) && measured > 0) line.measured_width_px = measured;
                }
                promoted = true;
            }
            if (promoted && frame.lines.length === 1) {
                frame.node_type = 'title';
                frame.heading_level = frame.lines[0].heading_level || null;
            }
        }
        return built;
    }

    function fixedBlockFrameWidth(frame, contentWidthPx) {
        const measured = Number(frame?.lines?.[0]?.measured_width_px);
        const fallback = Number(frame?.placement?.width_px || frame?.placement?.line_width_px);
        const width = Number.isFinite(measured) && measured > 0 ? measured : fallback;
        return Math.max(1, Math.min(Math.max(1, Number(contentWidthPx) || 1), Number(width) || 1));
    }

    function blockRowHeightPx(frame, built, responsive = ResponsiveLayout) {
        const baseLineHeightPx = Math.max(1, Number(built?.options?.lineHeightPx) || 1);
        const row = frame?.lines?.[0];
        if (!row) return baseLineHeightPx;

        if (typeof responsive?.measuredRowMetrics === 'function') {
            const metrics = responsive.measuredRowMetrics(row, {
                baseFontSizePx: Math.max(1, Number(built?.options?.fontSizePx) || 28),
                baseLineHeightPx,
            });
            const measured = Number(metrics?.row_height_px);
            if (Number.isFinite(measured) && measured > 0) return measured;
        }

        const annotated = Number(row?.row_height_px);
        return Number.isFinite(annotated) && annotated > 0 ? annotated : baseLineHeightPx;
    }

    function reflowMovingBlockVerticalPlacement(built, responsive = ResponsiveLayout) {
        if (!built) return built;
        if (built.options?.movingBlockVerticalReflow === true) return built;
        const frames = Array.isArray(built.frames) ? built.frames : [];
        const baseLineHeightPx = Math.max(1, Number(built.options?.lineHeightPx) || 1);
        const configuredCapacity = Number(built.options?.pageLineCapacity);
        const capacity = Number.isFinite(configuredCapacity) && configuredCapacity > 0
            ? Math.max(1, Math.floor(configuredCapacity))
            : Number.POSITIVE_INFINITY;
        const configuredPageHeightPx = Number(built.options?.pageHeightPx);
        const pageHeightPx = Number.isFinite(configuredPageHeightPx) && configuredPageHeightPx > 0
            ? configuredPageHeightPx
            : (Number.isFinite(capacity) ? capacity * baseLineHeightPx : baseLineHeightPx);

        let virtualPageIndex = 0;
        let lineIndex = 0;
        let usedHeightPx = 0;
        let index = 0;

        const startFreshPage = () => {
            virtualPageIndex += 1;
            lineIndex = 0;
            usedHeightPx = 0;
        };

        while (index < frames.length) {
            const frame = frames[index];
            if (frame?.kind === 'manual') {
                if (lineIndex > 0 || usedHeightPx > 0) startFreshPage();
                frame.placement = {
                    ...(frame.placement || {}),
                    virtual_page_index: virtualPageIndex,
                    line_index: 0,
                    y_px: 0,
                };
                startFreshPage();
                index += 1;
                continue;
            }

            if (frame?.kind !== 'timed_text' || !frame?.placement) {
                index += 1;
                continue;
            }

            const originalPageIndex = Number(frame.placement.virtual_page_index);
            const originalLineIndex = Number(frame.placement.line_index);
            let groupEnd = index + 1;
            while (groupEnd < frames.length) {
                const next = frames[groupEnd];
                if (next?.kind !== 'timed_text' || !next?.placement) break;
                if (
                    Number(next.placement.virtual_page_index) !== originalPageIndex
                    || Number(next.placement.line_index) !== originalLineIndex
                ) break;
                groupEnd += 1;
            }

            const rowHeightPx = blockRowHeightPx(frame, built, responsive);
            const paragraphGapPx = lineIndex > 0
                ? Math.max(0, Number(frame.lines?.[0]?.paragraph_gap_before_px) || 0)
                : 0;
            const exceedsCapacity = lineIndex > 0 && lineIndex >= capacity;
            const exceedsHeight = lineIndex > 0
                && usedHeightPx + paragraphGapPx + rowHeightPx > pageHeightPx + 0.01;
            if (exceedsCapacity || exceedsHeight) startFreshPage();

            const appliedParagraphGapPx = lineIndex > 0
                ? Math.max(0, Number(frame.lines?.[0]?.paragraph_gap_before_px) || 0)
                : 0;
            const yPx = usedHeightPx + appliedParagraphGapPx;
            for (let groupIndex = index; groupIndex < groupEnd; groupIndex += 1) {
                const groupedFrame = frames[groupIndex];
                groupedFrame.placement = {
                    ...(groupedFrame.placement || {}),
                    virtual_page_index: virtualPageIndex,
                    line_index: lineIndex,
                    y_px: yPx,
                };
            }

            usedHeightPx = yPx + rowHeightPx;
            lineIndex += 1;
            if (lineIndex >= capacity) startFreshPage();
            index = groupEnd;
        }

        built.options = {
            ...(built.options || {}),
            movingBlockVerticalReflow: true,
        };
        return built;
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
        if (displayScope !== 'block') {
            return originalBuild.call(responsive, adapter, documentView, nodes, options);
        }

        if (readingMode === 'moving') {
            const built = originalBuild.call(responsive, adapter, documentView, nodes, options);
            restoreCanonicalTocTitleTypography(built, nodes, options.measureText);
            return reflowMovingBlockVerticalPlacement(built, responsive);
        }

        // Fixed-viewpoint Block is a continuous measured stream: soft visual-line
        // endings and canonical paragraph boundaries do not constrain grouping.
        // Reuse the authoritative one-line measured builder at exactly the configured
        // block width so tokenization, punctuation hanging, English-word atomicity,
        // structure boundaries, timing, identity, and manual-frame boundaries remain
        // owned by the existing layout.
        const built = originalBuild.call(responsive, adapter, documentView, nodes, {
            ...options,
            displayScope: 'line',
            lineCount: 1,
            maxLines: 1,
            paragraphLayout: false,
        });
        restoreCanonicalTocTitleTypography(built, nodes, options.measureText);
        return convertLineBuildToFixedBlocks(built, options);
    }

    function runtimeContextNodes(controller, context) {
        if (Array.isArray(context?.nodes)) return context.nodes;
        const fallback = controller?.playbackContext?.();
        return Array.isArray(fallback?.nodes) ? fallback.nodes : [];
    }

    function decorateRuntimeBlockBuild(controller, built, context, responsive = ResponsiveLayout) {
        if (!built) return built;
        const displayScope = controller?.displayScope?.() || built.options?.displayScope || 'line';
        if (displayScope !== 'block') return built;
        const readingMode = normalizeReadingMode(
            controller?.readingMode?.() || built.options?.readingMode,
        );
        if (readingMode !== 'moving') return built;

        // The responsive Controller build path calls its module-local measured builder,
        // not the exported responsive.buildMeasuredPlaybackFrames property. Therefore
        // wrapping only the export is insufficient for browser runtime. Decorate the
        // actual Controller result here so moving Block vertical packing is guaranteed
        // to run in the same path that renderFrame consumes.
        restoreCanonicalTocTitleTypography(built, runtimeContextNodes(controller, context));
        return reflowMovingBlockVerticalPlacement(built, responsive);
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

        // Keep the exported helper wrapped for direct/pure construction paths.
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

        // Browser runtime does not call the exported function above: the responsive
        // controller closes over its module-local builder. Wrap the authoritative
        // Controller entrypoint as well so the policy cannot be bypassed at runtime.
        if (!prototype.__blockViewpointRuntimeBuildWrapped) {
            const originalBuildFrames = prototype.buildFrames;
            if (typeof originalBuildFrames !== 'function') return false;
            prototype.buildFrames = function blockViewpointRuntimeBuild(context) {
                const built = originalBuildFrames.call(this, context);
                return decorateRuntimeBlockBuild(this, built, context, responsive);
            };
            prototype.__blockViewpointRuntimeBuildWrapped = true;
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

        // Reader v2 owns block/line/page selector semantics even before a book is
        // open. The base handler returns before stopping propagation when Reader is
        // inactive, which lets legacy app.js treat block/line as its old Page mode
        // and replace the width controls with the obsolete max-lines panel.
        if (!prototype.__blockViewpointDisplayModeOwnershipWrapped) {
            const originalOnDisplayModeChanged = prototype.onDisplayModeChanged;
            if (typeof originalOnDisplayModeChanged !== 'function') return false;
            prototype.onDisplayModeChanged = function blockViewpointDisplayModeChanged(event) {
                event?.stopImmediatePropagation?.();
                this.updateSettingsVisibility?.();
                if (!this.isReaderActive?.()) {
                    this.applyVisualSettings?.();
                    return false;
                }
                return originalOnDisplayModeChanged.call(this, event);
            };
            prototype.__blockViewpointDisplayModeOwnershipWrapped = true;
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
        blockRowHeightPx,
        buildBlockAwarePlaybackFrames,
        canonicalTocTitleNodeIds,
        convertLineBuildToFixedBlocks,
        decorateRuntimeBlockBuild,
        fixedBlockFrameWidth,
        install,
        installWithRetry,
        normalizeNodeType,
        normalizeReadingMode,
        reflowMovingBlockVerticalPlacement,
        restoreCanonicalTocTitleTypography,
        runtimeContextNodes,
    };
});
