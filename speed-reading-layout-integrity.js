(function (root, factory) {
    const api = factory(
        root && root.SpeedReadingAdapter,
        root && root.SpeedReadingResponsiveLayout,
    );
    const isCommonJs = typeof module === 'object' && module.exports;
    if (isCommonJs) module.exports = api;
    if (root) {
        root.SpeedReadingLayoutIntegrity = api;
        if (!isCommonJs && root.document && typeof root.setTimeout === 'function') {
            root.setTimeout(() => api.installWithRetry(root), 0);
        }
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Adapter, ResponsiveLayout) {
    'use strict';

    const INSTALL_RETRY_MS = 20;
    const INSTALL_RETRY_LIMIT = 250;
    const VISUAL_TYPES_WITH_CAPTION = new Set(['figure', 'table']);

    function normalizeType(value) {
        return String(value || '').trim().toLowerCase().replace(/[\s-]+/gu, '_');
    }

    function resolvedNodeType(adapter, node) {
        if (typeof adapter?.resolvedTypeForNode === 'function') {
            return normalizeType(adapter.resolvedTypeForNode(node)?.type);
        }
        if (typeof adapter?.canonicalType === 'function') {
            return normalizeType(adapter.canonicalType(node?.node_type));
        }
        return normalizeType(node?.node_type);
    }

    function canonicalCaptionAssociations(adapter, nodes) {
        const visualParents = new Map();
        for (const node of nodes || []) {
            const type = resolvedNodeType(adapter, node);
            if (!VISUAL_TYPES_WITH_CAPTION.has(type)) continue;
            const nodeId = String(node?.node_id || '');
            if (nodeId) visualParents.set(nodeId, type);
        }

        const byParent = new Map();
        const consumedCaptionIds = new Set();
        for (const node of nodes || []) {
            if (resolvedNodeType(adapter, node) !== 'caption') continue;
            const parentRef = typeof node?.parent_ref === 'string' ? node.parent_ref.trim() : '';
            if (!parentRef || !visualParents.has(parentRef)) continue;
            const nodeId = String(node?.node_id || '');
            const text = typeof node?.text === 'string' ? node.text.trim() : '';
            if (!nodeId || !text) continue;
            if (!byParent.has(parentRef)) byParent.set(parentRef, []);
            byParent.get(parentRef).push({
                node_id: nodeId,
                text,
                order: Number(node?.order || 0),
                parent_ref: parentRef,
            });
            consumedCaptionIds.add(nodeId);
        }

        for (const captions of byParent.values()) {
            captions.sort((a, b) => a.order - b.order || a.node_id.localeCompare(b.node_id));
        }
        return { byParent, consumedCaptionIds };
    }

    function lineFrameCapacity(rawCapacity, lineCount) {
        const capacity = Math.max(1, Math.floor(Number(rawCapacity) || 1));
        const count = Math.max(1, Math.floor(Number(lineCount) || 1));
        if (count <= 1 || capacity < count) return capacity;
        return Math.max(count, Math.floor(capacity / count) * count);
    }

    function numericLineHeight(computed, fallbackFontSize, ratio = 1.55) {
        const parsed = Number.parseFloat(computed?.lineHeight);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
        const fontSize = Math.max(1, Number.parseFloat(computed?.fontSize) || Number(fallbackFontSize) || 28);
        return fontSize * Math.max(1, Number(ratio) || 1.55);
    }

    function withAssociatedCaptionsSuppressed(adapter, consumedCaptionIds, callback) {
        const originalBuildReadingElements = adapter?.buildReadingElements;
        if (typeof originalBuildReadingElements !== 'function' || !consumedCaptionIds?.size) {
            return callback();
        }
        adapter.buildReadingElements = function buildReadingElementsWithoutAssociatedCaptions(...args) {
            return originalBuildReadingElements.apply(this, args).filter((element) => (
                !consumedCaptionIds.has(String(element?.identity?.node_id || ''))
            ));
        };
        try {
            return callback();
        } finally {
            adapter.buildReadingElements = originalBuildReadingElements;
        }
    }

    function attachVisualCaptions(frames, associations) {
        const byParent = associations?.byParent || new Map();
        for (const frame of frames || []) {
            if (frame?.kind !== 'manual' || !VISUAL_TYPES_WITH_CAPTION.has(normalizeType(frame?.node_type))) continue;
            const nodeId = String(frame?.identity?.node_id || '');
            const captions = byParent.get(nodeId);
            if (!captions?.length) continue;
            frame.captions = captions.map((caption) => ({ ...caption }));
            frame.caption_text = captions.map((caption) => caption.text).join('\n');
            frame.caption_node_ids = captions.map((caption) => caption.node_id);
        }
        return frames;
    }

    function applySafeHorizontalInset(frames, insetPx) {
        const inset = Math.max(0, Number(insetPx) || 0);
        if (!inset) return frames;
        for (const frame of frames || []) {
            if (frame?.kind !== 'timed_text' || !frame?.placement) continue;
            const scope = String(frame.placement.display_scope || '');
            if (!['block', 'line', 'page'].includes(scope)) continue;
            frame.placement.x_px = Math.max(0, Number(frame.placement.x_px) || 0) + inset;
            frame.placement.content_origin_x_px = inset;
        }
        return frames;
    }

    function buildIntegrityPlaybackFrames(controller, rootObject) {
        const adapter = rootObject?.SpeedReadingAdapter || Adapter;
        const responsive = rootObject?.SpeedReadingResponsiveLayout || ResponsiveLayout;
        if (!controller?.reader?.openResponse || !adapter || !responsive?.buildMeasuredPlaybackFrames) return null;

        controller.updateSettingsVisibility?.();
        controller.applyVisualSettings?.();
        const settings = controller.adapterOptions?.() || {};
        const scope = controller.displayScope?.() || settings.displayScope || 'line';
        const target = scope === 'page' ? controller.element?.('pageText') : controller.element?.('focusText');
        const view = controller.document?.defaultView || rootObject;
        const computed = target && view?.getComputedStyle ? view.getComputedStyle(target) : null;
        const measureText = responsive.createCanvasMeasurer?.(controller.document, {
            fontFamily: computed?.fontFamily,
            fontSize: computed?.fontSize,
            fontStyle: computed?.fontStyle,
            fontWeight: computed?.fontWeight,
        });
        const lineHeightPx = numericLineHeight(
            computed,
            controller.element?.('fontInput')?.value || 28,
            responsive.DEFAULT_LINE_HEIGHT_RATIO,
        );
        const rawCapacity = responsive.pageLineCapacity?.(
            controller.playbackAvailableHeight?.(),
            lineHeightPx,
            responsive.DEFAULT_SAFE_VERTICAL_GUTTER_PX,
        ) || Math.max(1, Number(settings.lineCount || settings.maxLines) || 1);
        const lineCount = Math.max(1, Number(settings.lineCount || settings.maxLines) || 1);
        const pageLineCapacity = scope === 'line'
            ? lineFrameCapacity(rawCapacity, lineCount)
            : rawCapacity;

        const nodes = controller.reader.nodes || [];
        const associations = canonicalCaptionAssociations(adapter, nodes);
        const built = withAssociatedCaptionsSuppressed(adapter, associations.consumedCaptionIds, () => (
            responsive.buildMeasuredPlaybackFrames(adapter, controller.reader.openResponse, nodes, {
                ...settings,
                maxWidthPx: Math.max(1, Number(settings.maxWidthPx) || 1),
                pageLineCapacity,
                lineHeightPx,
                measureText,
            })
        ));
        if (!built) return null;

        attachVisualCaptions(built.frames, associations);
        const inset = Math.max(0, Number(responsive.DEFAULT_SAFE_GUTTER_PX) || 0) / 2;
        applySafeHorizontalInset(built.frames, inset);
        built.options = {
            ...(built.options || {}),
            rawPageLineCapacity: rawCapacity,
            pageLineCapacity,
            horizontalInsetPx: inset,
        };

        const punctuation = rootObject?.ReaderPunctuationHangingPolicy;
        if (typeof punctuation?.repairHangingPunctuation === 'function') {
            punctuation.repairHangingPunctuation(built.frames, adapter, settings.speedPerMinute);
        }
        return built;
    }

    function prependVisualCaptions(controller, frame, target) {
        if (!target || !Array.isArray(frame?.captions) || !frame.captions.length) return false;
        if (!VISUAL_TYPES_WITH_CAPTION.has(normalizeType(frame?.node_type))) return false;
        const nodes = [];
        for (const captionData of frame.captions) {
            const text = String(captionData?.text || '').trim();
            if (!text) continue;
            const caption = controller.document.createElement('div');
            caption.className = 'reader-playback-visual-caption reader-playback-line-caption';
            caption.textContent = text;
            caption.dataset.readerCaptionNodeId = String(captionData?.node_id || '');
            if (caption.style) {
                caption.style.marginBottom = '8px';
                caption.style.whiteSpace = 'normal';
            }
            nodes.push(caption);
        }
        for (let index = nodes.length - 1; index >= 0; index -= 1) {
            const caption = nodes[index];
            if (typeof target.prepend === 'function') target.prepend(caption);
            else if (typeof target.insertBefore === 'function') target.insertBefore(caption, target.firstChild || null);
            else target.appendChild?.(caption);
        }
        return nodes.length > 0;
    }

    function rendererChainReady(rootObject) {
        const prototype = rootObject?.ReaderSpeedPlaybackUI?.ReaderSpeedPlaybackUIController?.prototype;
        return Boolean(prototype && prototype.__responsiveLayoutInstalled);
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const PlaybackUI = rootObject?.ReaderSpeedPlaybackUI;
        const Controller = PlaybackUI?.ReaderSpeedPlaybackUIController;
        if (!Controller?.prototype || !rendererChainReady(rootObject)) return false;
        const prototype = Controller.prototype;
        if (prototype.__speedReadingLayoutIntegrityInstalled) return true;

        const originalRefreshFrames = prototype.refreshFrames;
        const originalRenderManualFrame = prototype.renderManualFrame;
        if (typeof originalRefreshFrames !== 'function' || typeof originalRenderManualFrame !== 'function') return false;

        prototype.refreshFrames = function integrityRefreshFrames(options = {}) {
            if (!this.reader?.openResponse) return originalRefreshFrames.call(this, options);
            const built = buildIntegrityPlaybackFrames(this, rootObject);
            if (!built) return originalRefreshFrames.call(this, options);
            this.playback.setFrames(built.frames, { preserveIdentity: options.preserveIdentity !== false });
            this.updateControls?.();
            return built.frames;
        };

        prototype.renderManualFrame = function renderManualFrameWithCanonicalCaption(frame, target) {
            const result = originalRenderManualFrame.call(this, frame, target);
            prependVisualCaptions(this, frame, target);
            return result;
        };

        prototype.__speedReadingLayoutIntegrityInstalled = true;
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
        VISUAL_TYPES_WITH_CAPTION,
        applySafeHorizontalInset,
        attachVisualCaptions,
        buildIntegrityPlaybackFrames,
        canonicalCaptionAssociations,
        install,
        installWithRetry,
        lineFrameCapacity,
        numericLineHeight,
        prependVisualCaptions,
        rendererChainReady,
        resolvedNodeType,
        withAssociatedCaptionsSuppressed,
    };
});
