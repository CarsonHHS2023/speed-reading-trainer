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
    const GLYPH_BLEED_PX = 6;
    const CAPTION_VISUAL_POLICY = 'same_page_spatial_visual_v1_frontend_fallback';
    const CAPTION_VISUAL_MAX_VERTICAL_GAP = 0.18;
    const CAPTION_VISUAL_MIN_HORIZONTAL_OVERLAP = 0.40;
    const CAPTION_VISUAL_MAX_CENTER_DELTA = 0.16;
    const CAPTION_VISUAL_AMBIGUITY_MARGIN = 0.025;

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

    function canonicalNodeId(node) {
        return String(node?.node_id || '').trim();
    }

    function canonicalParentRef(node) {
        return typeof node?.parent_ref === 'string' ? node.parent_ref.trim() : '';
    }

    function isSourceRenderingPresentationNode(node) {
        return normalizeType(node?.metadata?.presentation_mode || node?.presentation_mode) === 'source_rendering';
    }

    function pushGrouped(map, key, value) {
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(value);
    }

    function sourceUnitIdForNode(node) {
        const locationUnit = String(node?.location?.source_unit_id || '').trim();
        if (locationUnit) return locationUnit;
        const locationAnchorUnit = String(node?.location?.source_anchor?.source_unit_id || '').trim();
        if (locationAnchorUnit) return locationAnchorUnit;
        const ids = Array.isArray(node?.source_unit_ids)
            ? node.source_unit_ids.map((value) => String(value || '').trim()).filter(Boolean)
            : [];
        if (ids.length === 1) return ids[0];
        const anchors = Array.isArray(node?.source_anchors) ? node.source_anchors : [];
        const units = [...new Set(anchors.map((anchor) => String(anchor?.source_unit_id || '').trim()).filter(Boolean))];
        return units.length === 1 ? units[0] : '';
    }

    function normalizedSpatialAnchor(node) {
        const candidates = [
            node?.location?.source_anchor,
            ...(Array.isArray(node?.source_anchors) ? node.source_anchors : []),
        ];
        for (const anchor of candidates) {
            if (!anchor || normalizeType(anchor.kind) !== 'spatial') continue;
            const bbox = Array.isArray(anchor.normalized_bbox) ? anchor.normalized_bbox : null;
            if (!bbox || bbox.length !== 4) continue;
            const values = bbox.map((value) => Number(value));
            if (!values.every(Number.isFinite)) continue;
            const [left, top, right, bottom] = values;
            if (!(right > left && bottom > top)) continue;
            return {
                left, top, right, bottom,
                source_unit_id: String(anchor.source_unit_id || sourceUnitIdForNode(node) || '').trim(),
            };
        }
        return null;
    }

    function samePage(caption, visual, { requireKnown = false } = {}) {
        const captionUnit = sourceUnitIdForNode(caption);
        const visualUnit = sourceUnitIdForNode(visual);
        if (!captionUnit || !visualUnit) return !requireKnown;
        return captionUnit === visualUnit;
    }

    function captionAllowedVisualTypes(node) {
        const values = [
            node?.metadata?.caption_association_target_kind,
            node?.metadata?.provider_block_label,
            node?.metadata?.block_label,
            node?.raw_node_type,
        ].map(normalizeType).filter(Boolean);
        if (values.some((value) => value === 'table' || value.startsWith('table_'))) return new Set(['table']);
        if (values.some((value) => value === 'figure' || value.startsWith('figure_'))) return new Set(['figure']);
        return new Set(VISUAL_TYPES_WITH_CAPTION);
    }

    function captionVisualMetrics(captionAnchor, visualAnchor) {
        if (!captionAnchor || !visualAnchor) return null;
        if (!captionAnchor.source_unit_id || !visualAnchor.source_unit_id) return null;
        if (captionAnchor.source_unit_id !== visualAnchor.source_unit_id) return null;

        let verticalGap = 0;
        if (captionAnchor.bottom < visualAnchor.top) verticalGap = visualAnchor.top - captionAnchor.bottom;
        else if (visualAnchor.bottom < captionAnchor.top) verticalGap = captionAnchor.top - visualAnchor.bottom;
        if (verticalGap > CAPTION_VISUAL_MAX_VERTICAL_GAP) return null;

        const overlap = Math.max(0, Math.min(captionAnchor.right, visualAnchor.right) - Math.max(captionAnchor.left, visualAnchor.left));
        const smallerWidth = Math.min(
            captionAnchor.right - captionAnchor.left,
            visualAnchor.right - visualAnchor.left,
        );
        const horizontalOverlap = smallerWidth > 0 ? overlap / smallerWidth : 0;
        const captionCenter = (captionAnchor.left + captionAnchor.right) / 2;
        const visualCenter = (visualAnchor.left + visualAnchor.right) / 2;
        const centerDelta = Math.abs(captionCenter - visualCenter);
        if (
            horizontalOverlap < CAPTION_VISUAL_MIN_HORIZONTAL_OVERLAP
            && centerDelta > CAPTION_VISUAL_MAX_CENTER_DELTA
        ) return null;

        return {
            score: verticalGap + (centerDelta * 0.35) + ((1 - Math.min(1, horizontalOverlap)) * 0.05),
            vertical_gap: verticalGap,
            horizontal_overlap: horizontalOverlap,
            center_delta: centerDelta,
        };
    }

    function canonicalCaptionAssociations(adapter, nodes) {
        const visualById = new Map();
        const visuals = [];
        const captions = [];

        for (const node of nodes || []) {
            const type = resolvedNodeType(adapter, node);
            const nodeId = canonicalNodeId(node);
            if (!nodeId) continue;
            if (VISUAL_TYPES_WITH_CAPTION.has(type)) {
                const visual = { node, node_id: nodeId, type };
                visualById.set(nodeId, visual);
                visuals.push(visual);
            } else if (type === 'caption') {
                const text = typeof node?.text === 'string' ? node.text.trim() : '';
                if (text) captions.push(node);
            }
        }

        const byParent = new Map();
        const consumedCaptionIds = new Set();
        const unresolvedCaptionIds = new Set();
        const fallbackBoundVisualIds = new Set();

        const bindCaption = (caption, target, associationMode, metrics = null) => {
            const nodeId = canonicalNodeId(caption);
            const text = typeof caption?.text === 'string' ? caption.text.trim() : '';
            if (!nodeId || !text || !target?.node_id) return false;
            if (!byParent.has(target.node_id)) byParent.set(target.node_id, []);
            byParent.get(target.node_id).push({
                node_id: nodeId,
                text,
                order: Number(caption?.order || 0),
                parent_ref: canonicalParentRef(caption),
                target_node_id: target.node_id,
                association_mode: associationMode,
                ...(metrics ? { association_metrics: { ...metrics } } : {}),
            });
            consumedCaptionIds.add(nodeId);
            return true;
        };

        for (const caption of captions) {
            const captionId = canonicalNodeId(caption);
            const parentRef = canonicalParentRef(caption);
            const directParent = visualById.get(parentRef) || null;
            let explicitTarget = null;
            if (directParent && samePage(caption, directParent.node)) {
                explicitTarget = directParent;
            } else {
                const reciprocal = visuals.filter((visual) => (
                    Array.isArray(visual.node?.child_refs)
                    && visual.node.child_refs.map((value) => String(value || '').trim()).includes(captionId)
                    && samePage(caption, visual.node)
                ));
                if (reciprocal.length === 1) explicitTarget = reciprocal[0];
            }
            if (explicitTarget) bindCaption(caption, explicitTarget, 'canonical_direct_visual_relation');
        }

        for (const caption of captions) {
            const captionId = canonicalNodeId(caption);
            if (consumedCaptionIds.has(captionId)) continue;
            const captionAnchor = normalizedSpatialAnchor(caption);
            if (!captionAnchor?.source_unit_id) {
                unresolvedCaptionIds.add(captionId);
                continue;
            }

            const allowedTypes = captionAllowedVisualTypes(caption);
            const parentRef = canonicalParentRef(caption);
            const candidates = [];
            for (const visual of visuals) {
                if (!allowedTypes.has(visual.type)) continue;
                if (isSourceRenderingPresentationNode(visual.node)) continue;
                if (fallbackBoundVisualIds.has(visual.node_id) || byParent.has(visual.node_id)) continue;
                if (!samePage(caption, visual.node, { requireKnown: true })) continue;
                const visualAnchor = normalizedSpatialAnchor(visual.node);
                const metrics = captionVisualMetrics(captionAnchor, visualAnchor);
                if (!metrics) continue;
                candidates.push({
                    visual,
                    metrics,
                    same_parent: Boolean(parentRef && canonicalParentRef(visual.node) === parentRef),
                    order_delta: Math.abs(Number(caption?.order || 0) - Number(visual.node?.order || 0)),
                });
            }

            candidates.sort((a, b) => (
                a.metrics.score - b.metrics.score
                || a.order_delta - b.order_delta
                || Number(b.same_parent) - Number(a.same_parent)
                || Number(a.visual.node?.order || 0) - Number(b.visual.node?.order || 0)
                || a.visual.node_id.localeCompare(b.visual.node_id)
            ));

            if (!candidates.length) {
                unresolvedCaptionIds.add(captionId);
                continue;
            }
            if (
                candidates.length > 1
                && candidates[1].metrics.score - candidates[0].metrics.score < CAPTION_VISUAL_AMBIGUITY_MARGIN
            ) {
                unresolvedCaptionIds.add(captionId);
                continue;
            }

            const best = candidates[0];
            if (bindCaption(caption, best.visual, CAPTION_VISUAL_POLICY, {
                vertical_gap: best.metrics.vertical_gap,
                horizontal_overlap: best.metrics.horizontal_overlap,
                center_delta: best.metrics.center_delta,
                order_delta: best.order_delta,
                shared_parent: best.same_parent,
            })) {
                fallbackBoundVisualIds.add(best.visual.node_id);
            } else {
                unresolvedCaptionIds.add(captionId);
            }
        }

        for (const caption of captions) {
            const captionId = canonicalNodeId(caption);
            if (!consumedCaptionIds.has(captionId)) unresolvedCaptionIds.add(captionId);
        }
        for (const attached of byParent.values()) {
            attached.sort((a, b) => a.order - b.order || a.node_id.localeCompare(b.node_id));
        }

        return {
            byParent,
            consumedCaptionIds,
            suppressedVisualContainerIds: new Set(),
            suppressedPlaybackNodeIds: new Set(consumedCaptionIds),
            unresolvedCaptionIds,
            fallbackBoundVisualIds,
        };
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

    function withPlaybackElementPolicy(adapter, excludedNodeIds, callback) {
        const originalBuildReadingElements = adapter?.buildReadingElements;
        if (typeof originalBuildReadingElements !== 'function') return callback();
        const excluded = excludedNodeIds || new Set();
        adapter.buildReadingElements = function buildReadingElementsWithCanonicalRelations(...args) {
            return originalBuildReadingElements.apply(this, args).filter((element) => (
                !excluded.has(String(element?.identity?.node_id || '').trim())
            ));
        };
        try {
            return callback();
        } finally {
            adapter.buildReadingElements = originalBuildReadingElements;
        }
    }

    function withAssociatedCaptionsSuppressed(adapter, consumedCaptionIds, callback) {
        return withPlaybackElementPolicy(adapter, consumedCaptionIds, callback);
    }

    function attachVisualCaptions(frames, associations) {
        const byParent = associations?.byParent || new Map();
        for (const frame of frames || []) {
            if (frame?.kind !== 'manual' || !VISUAL_TYPES_WITH_CAPTION.has(normalizeType(frame?.node_type))) continue;
            const nodeId = String(frame?.identity?.node_id || '').trim();
            const captionsForFrame = byParent.get(nodeId);
            if (!captionsForFrame?.length) continue;
            frame.captions = captionsForFrame.map((caption) => ({ ...caption }));
            frame.caption_text = captionsForFrame.map((caption) => caption.text).join('\n');
            frame.caption_node_ids = captionsForFrame.map((caption) => caption.node_id);
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

    function applyRuntimeHorizontalPlacement(controller, frame, target, rootObject) {
        if (!controller || !target || frame?.kind !== 'timed_text') return null;
        const placement = frame.placement || {};
        const scope = controller.displayScope?.() || String(placement.display_scope || 'line');
        const mode = controller.readingMode?.() || 'focus';
        if (scope !== 'page' && mode !== 'moving') return null;

        const container = target.querySelector?.('.reader-playback-frame-text');
        if (!container?.style) return null;
        const responsive = rootObject?.SpeedReadingResponsiveLayout || ResponsiveLayout;
        const view = controller.document?.defaultView || rootObject;
        const targetWidth = Math.max(
            1,
            Number(responsive?.contentBoxWidth?.(target, view)) || Number(target?.clientWidth) || 1,
        );
        const planeWidth = Math.max(1, Number(placement.content_width_px) || targetWidth);
        const buildOrigin = Math.max(0, Number(placement.content_origin_x_px) || 0);
        const storedX = Math.max(0, Number(placement.x_px) || 0);
        const internalX = Math.max(0, storedX - buildOrigin);
        const frameWidth = Math.max(1, Number(placement.width_px) || Number(placement.line_width_px) || 1);
        const runtimeOrigin = Math.max(0, (targetWidth - planeWidth) / 2);
        const maxLeft = Math.max(0, targetWidth - frameWidth);
        const left = Math.max(0, Math.min(runtimeOrigin + internalX, maxLeft));
        container.style.left = `${left}px`;
        return {
            target_width_px: targetWidth,
            measured_plane_width_px: planeWidth,
            build_origin_x_px: buildOrigin,
            runtime_origin_x_px: runtimeOrigin,
            internal_x_px: internalX,
            rendered_left_px: left,
        };
    }

    function bindReadingModeRerender(controller) {
        const mode = controller?.element?.('trainingMode');
        if (!mode?.addEventListener || controller.__layoutIntegrityReadingModeRerenderBound) return false;
        controller.__layoutIntegrityReadingModeRerenderBound = true;
        mode.addEventListener('change', () => {
            if (!controller.isReaderActive?.()) return;
            const frame = controller.playback?.currentFrame?.();
            if (frame) controller.showPlaybackSurface?.(frame);
        });
        return true;
    }

    function measuredFallbackBuild(controller, rootObject, context) {
        const adapter = rootObject?.SpeedReadingAdapter || Adapter;
        const responsive = rootObject?.SpeedReadingResponsiveLayout || ResponsiveLayout;
        if (!adapter || !responsive?.buildMeasuredPlaybackFrames || !context?.nodes?.length) return null;
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
        const pageLineCapacity = scope === 'line' ? lineFrameCapacity(rawCapacity, lineCount) : rawCapacity;
        const built = responsive.buildMeasuredPlaybackFrames(adapter, controller.reader.openResponse, context.nodes, {
            ...settings,
            maxWidthPx: Math.max(1, Number(settings.maxWidthPx) || 1),
            pageLineCapacity,
            lineHeightPx,
            measureText,
        });
        if (built) {
            built.options = {
                ...(built.options || {}),
                rawPageLineCapacity: rawCapacity,
                pageLineCapacity,
            };
        }
        return built;
    }

    function buildIntegrityPlaybackFrames(controller, rootObject, context = null, baseBuildFrames = null) {
        const adapter = rootObject?.SpeedReadingAdapter || Adapter;
        const responsive = rootObject?.SpeedReadingResponsiveLayout || ResponsiveLayout;
        if (!controller?.reader?.openResponse || !adapter || !responsive) return null;
        const playbackContext = context || controller.playbackContext?.();
        if (!playbackContext?.nodes?.length) return null;

        const associations = canonicalCaptionAssociations(adapter, playbackContext.nodes);
        const build = () => {
            if (typeof baseBuildFrames === 'function') return baseBuildFrames(playbackContext);
            return measuredFallbackBuild(controller, rootObject, playbackContext);
        };
        const built = withPlaybackElementPolicy(adapter, associations.suppressedPlaybackNodeIds, build);
        if (!built || !Array.isArray(built.frames)) return built;

        attachVisualCaptions(built.frames, associations);
        const inset = Math.max(0, Number(responsive.DEFAULT_SAFE_GUTTER_PX) || 0) / 2;
        applySafeHorizontalInset(built.frames, inset);
        built.options = {
            ...(built.options || {}),
            horizontalInsetPx: inset,
        };
        built.captionAssociations = associations;

        const punctuation = rootObject?.ReaderPunctuationHangingPolicy;
        const settings = controller.adapterOptions?.() || {};
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

    function setImportant(style, property, value) {
        if (!style) return;
        if (typeof style.setProperty === 'function') style.setProperty(property, value, 'important');
        else style[property.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
    }

    function relaxTimedTextClipping(target, glyphBleedPx = GLYPH_BLEED_PX) {
        const bleed = Math.max(0, Number(glyphBleedPx) || 0);
        setImportant(target?.style, 'overflow', 'hidden');
        const container = target?.querySelector?.('.reader-playback-frame-text');
        setImportant(container?.style, 'overflow', 'visible');
        const structured = target?.querySelector?.('.reader-playback-frame-structured');
        setImportant(structured?.style, 'overflow', 'visible');

        const rows = target?.querySelectorAll?.('.reader-playback-line') || [];
        for (const row of rows) {
            // Keep the measured row geometry authoritative. The former 100%+bleed
            // expansion combined with visible overflow allowed any Canvas/browser
            // measurement drift to escape the configured Page/Line width. CSS clip
            // margin still gives glyphs a bounded antialiasing allowance without
            // turning the row into an unbounded full-width paint surface.
            setImportant(row?.style, 'box-sizing', 'border-box');
            setImportant(row?.style, 'width', '100%');
            setImportant(row?.style, 'max-width', '100%');
            setImportant(row?.style, 'margin-inline', '0');
            setImportant(row?.style, 'padding-inline', '0');
            setImportant(row?.style, 'overflow', 'clip');
            if (bleed > 0) setImportant(row?.style, 'overflow-clip-margin', `${bleed}px`);
        }
        return rows.length;
    }

    function rendererChainReady(rootObject) {
        const prototype = rootObject?.ReaderSpeedPlaybackUI?.ReaderSpeedPlaybackUIController?.prototype;
        return Boolean(prototype && prototype.__responsiveLayoutInstalled && typeof prototype.buildFrames === 'function');
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const PlaybackUI = rootObject?.ReaderSpeedPlaybackUI;
        const Controller = PlaybackUI?.ReaderSpeedPlaybackUIController;
        if (!Controller?.prototype || !rendererChainReady(rootObject)) return false;
        const prototype = Controller.prototype;
        if (prototype.__speedReadingLayoutIntegrityInstalled) return true;

        const originalBuildFrames = prototype.buildFrames;
        const originalRenderManualFrame = prototype.renderManualFrame;
        const originalRenderFrame = prototype.renderFrame;
        if (
            typeof originalBuildFrames !== 'function'
            || typeof originalRenderManualFrame !== 'function'
            || typeof originalRenderFrame !== 'function'
        ) return false;

        prototype.buildFrames = function integrityBuildFrames(context) {
            return buildIntegrityPlaybackFrames(
                this,
                rootObject,
                context || this.playbackContext?.(),
                (resolvedContext) => originalBuildFrames.call(this, resolvedContext),
            ) || originalBuildFrames.call(this, context);
        };

        prototype.renderFrame = function renderFrameWithoutGlyphClipping(frame, target) {
            const result = originalRenderFrame.call(this, frame, target);
            if (frame?.kind === 'timed_text') {
                applyRuntimeHorizontalPlacement(this, frame, target, rootObject);
                relaxTimedTextClipping(target);
            }
            return result;
        };

        prototype.renderManualFrame = function renderManualFrameWithCanonicalCaption(frame, target) {
            const result = originalRenderManualFrame.call(this, frame, target);
            prependVisualCaptions(this, frame, target);
            return result;
        };

        prototype.__speedReadingLayoutIntegrityInstalled = true;
        const controller = PlaybackUI?.getDefaultController?.();
        if (controller) bindReadingModeRerender(controller);
        return true;
    }

    function installWithRetry(rootObject = typeof globalThis !== 'undefined' ? globalThis : null, attempt = 0) {
        if (install(rootObject)) return true;
        if (!rootObject || attempt >= INSTALL_RETRY_LIMIT || typeof rootObject.setTimeout !== 'function') return false;
        rootObject.setTimeout(() => installWithRetry(rootObject, attempt + 1), INSTALL_RETRY_MS);
        return false;
    }

    return {
        CAPTION_VISUAL_AMBIGUITY_MARGIN,
        CAPTION_VISUAL_MAX_CENTER_DELTA,
        CAPTION_VISUAL_MAX_VERTICAL_GAP,
        CAPTION_VISUAL_MIN_HORIZONTAL_OVERLAP,
        CAPTION_VISUAL_POLICY,
        GLYPH_BLEED_PX,
        INSTALL_RETRY_LIMIT,
        INSTALL_RETRY_MS,
        VISUAL_TYPES_WITH_CAPTION,
        applyRuntimeHorizontalPlacement,
        applySafeHorizontalInset,
        attachVisualCaptions,
        bindReadingModeRerender,
        buildIntegrityPlaybackFrames,
        canonicalCaptionAssociations,
        canonicalNodeId,
        canonicalParentRef,
        captionAllowedVisualTypes,
        captionVisualMetrics,
        install,
        installWithRetry,
        isSourceRenderingPresentationNode,
        lineFrameCapacity,
        measuredFallbackBuild,
        normalizedSpatialAnchor,
        numericLineHeight,
        prependVisualCaptions,
        pushGrouped,
        relaxTimedTextClipping,
        rendererChainReady,
        resolvedNodeType,
        samePage,
        setImportant,
        sourceUnitIdForNode,
        withAssociatedCaptionsSuppressed,
        withPlaybackElementPolicy,
    };
});