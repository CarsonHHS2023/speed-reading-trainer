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

    function canonicalCaptionAssociations(adapter, nodes) {
        // Reader v2 exposes the selected candidate's canonical semantic hierarchy:
        // parent_ref is node.parent_id and child_refs are its children. Do not infer
        // caption ownership from proximity, text, page position, or playback order.
        //
        // Real recovered documents can represent a visual+caption association in
        // either of two canonical graph shapes:
        //   1) caption.parent_ref === visual.node_id (direct visual parent), or
        //   2) caption and visual share one semantic parent/group.
        // A visual parent may itself act as a container and contain one more-specific
        // visual child. In that case the leaf visual is the playback target and the
        // container visual is suppressed so the same semantic object is not played
        // twice. Ambiguous groups are intentionally left unbound.
        const visualById = new Map();
        const allVisualChildrenByParent = new Map();
        const semanticVisualChildrenByParent = new Map();

        for (const node of nodes || []) {
            const type = resolvedNodeType(adapter, node);
            if (!VISUAL_TYPES_WITH_CAPTION.has(type)) continue;
            const nodeId = canonicalNodeId(node);
            if (!nodeId) continue;
            const visual = { node, node_id: nodeId, type };
            visualById.set(nodeId, visual);
            const parentRef = canonicalParentRef(node);
            pushGrouped(allVisualChildrenByParent, parentRef, visual);
            if (!isSourceRenderingPresentationNode(node)) {
                pushGrouped(semanticVisualChildrenByParent, parentRef, visual);
            }
        }

        const byParent = new Map();
        const consumedCaptionIds = new Set();
        const suppressedVisualContainerIds = new Set();
        const unresolvedCaptionIds = new Set();

        const bindCaption = (caption, target, associationMode) => {
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
            });
            consumedCaptionIds.add(nodeId);
            return true;
        };

        for (const node of nodes || []) {
            if (resolvedNodeType(adapter, node) !== 'caption') continue;
            const captionId = canonicalNodeId(node);
            const parentRef = canonicalParentRef(node);
            const text = typeof node?.text === 'string' ? node.text.trim() : '';
            if (!captionId || !parentRef || !text) continue;

            const directVisualParent = visualById.get(parentRef) || null;
            const semanticChildren = semanticVisualChildrenByParent.get(parentRef) || [];
            const allChildren = allVisualChildrenByParent.get(parentRef) || [];
            let target = null;
            let associationMode = '';

            if (directVisualParent) {
                if (semanticChildren.length === 1) {
                    // Canonical visual container -> unique semantic visual child.
                    target = semanticChildren[0];
                    associationMode = 'canonical_visual_parent_unique_child';
                    suppressedVisualContainerIds.add(directVisualParent.node_id);
                } else if (semanticChildren.length === 0) {
                    // Leaf visual parent: the direct relationship is already exact.
                    target = directVisualParent;
                    associationMode = 'canonical_direct_visual_parent';
                }
            } else {
                // Shared semantic parent/group. Prefer semantic visual children so a
                // source-rendered page carrier cannot steal a caption from the actual
                // Figure/Table node. If there are no semantic visuals, a single
                // source-rendered visual is still an unambiguous canonical target.
                const candidates = semanticChildren.length ? semanticChildren : allChildren;
                if (candidates.length === 1) {
                    target = candidates[0];
                    associationMode = 'canonical_shared_parent_unique_visual';
                }
            }

            if (!target || !bindCaption(node, target, associationMode)) {
                unresolvedCaptionIds.add(captionId);
            }
        }

        for (const captions of byParent.values()) {
            captions.sort((a, b) => a.order - b.order || a.node_id.localeCompare(b.node_id));
        }
        const suppressedPlaybackNodeIds = new Set([
            ...consumedCaptionIds,
            ...suppressedVisualContainerIds,
        ]);
        return {
            byParent,
            consumedCaptionIds,
            suppressedVisualContainerIds,
            suppressedPlaybackNodeIds,
            unresolvedCaptionIds,
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
            // Preserve Reader v2's canonical preorder exactly. The only mutation here
            // is removing captions already represented in a visual frame and visual
            // container nodes whose unique visual child is the canonical playback
            // surface for that same semantic object.
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
        const built = withPlaybackElementPolicy(adapter, associations.suppressedPlaybackNodeIds, () => (
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
        built.captionAssociations = associations;

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

    function setImportant(style, property, value) {
        if (!style) return;
        if (typeof style.setProperty === 'function') style.setProperty(property, value, 'important');
        else style[property.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
    }

    function relaxTimedTextClipping(target, glyphBleedPx = GLYPH_BLEED_PX) {
        const bleed = Math.max(0, Number(glyphBleedPx) || 0);
        setImportant(target?.style, 'overflow', 'visible');

        const container = target?.querySelector?.('.reader-playback-frame-text');
        setImportant(container?.style, 'overflow', 'visible');
        const structured = target?.querySelector?.('.reader-playback-frame-structured');
        setImportant(structured?.style, 'overflow', 'visible');

        const rows = target?.querySelectorAll?.('.reader-playback-line') || [];
        for (const row of rows) {
            setImportant(row?.style, 'overflow', 'visible');
            if (bleed > 0) {
                // Expand the row's paint box without moving the measured text origin:
                // -bleed margin + bleed padding keeps x unchanged while allowing glyph
                // side bearings/antialiasing to paint outside the measured line box.
                setImportant(row?.style, 'margin-inline', `-${bleed}px`);
                setImportant(row?.style, 'padding-inline', `${bleed}px`);
                setImportant(row?.style, 'width', `calc(100% + ${bleed * 2}px)`);
            }
        }
        return rows.length;
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
        const originalRenderFrame = prototype.renderFrame;
        if (
            typeof originalRefreshFrames !== 'function'
            || typeof originalRenderManualFrame !== 'function'
            || typeof originalRenderFrame !== 'function'
        ) return false;

        prototype.refreshFrames = function integrityRefreshFrames(options = {}) {
            if (!this.reader?.openResponse) return originalRefreshFrames.call(this, options);
            const built = buildIntegrityPlaybackFrames(this, rootObject);
            if (!built) return originalRefreshFrames.call(this, options);
            this.playback.setFrames(built.frames, { preserveIdentity: options.preserveIdentity !== false });
            this.updateControls?.();
            return built.frames;
        };

        prototype.renderFrame = function renderFrameWithoutGlyphClipping(frame, target) {
            const result = originalRenderFrame.call(this, frame, target);
            if (frame?.kind === 'timed_text') relaxTimedTextClipping(target);
            return result;
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
        GLYPH_BLEED_PX,
        INSTALL_RETRY_LIMIT,
        INSTALL_RETRY_MS,
        VISUAL_TYPES_WITH_CAPTION,
        applySafeHorizontalInset,
        attachVisualCaptions,
        buildIntegrityPlaybackFrames,
        canonicalCaptionAssociations,
        canonicalNodeId,
        canonicalParentRef,
        install,
        installWithRetry,
        isSourceRenderingPresentationNode,
        lineFrameCapacity,
        numericLineHeight,
        prependVisualCaptions,
        pushGrouped,
        relaxTimedTextClipping,
        rendererChainReady,
        resolvedNodeType,
        setImportant,
        withAssociatedCaptionsSuppressed,
        withPlaybackElementPolicy,
    };
});