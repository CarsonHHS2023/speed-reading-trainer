(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.ReaderSemanticLayoutEdgePolishV2 = api;
        if (root.document) api.install({ root });
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const INSTALL_RETRY_MS = 20;
    const INSTALL_MAX_ATTEMPTS = 500;
    const INLINE_ROW_MIN_GAP_PX = 8;
    const HEADER_BODY_GAP_PX = 16;
    const HEADER_HORIZONTAL_PADDING_PX = 8;
    const HEADER_PAGE_EDGE = 0.04;
    const VISUAL_CAPTION_GAP_PX = 6;
    const FURNITURE_TYPES = new Set(['header', 'footer', 'footnote']);
    const VISUAL_CAPTION_PARENT_TYPES = new Set(['figure', 'table']);

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function normalizeBbox(value) {
        if (typeof value === 'string') value = value.split(',').map(Number);
        if (!Array.isArray(value) || value.length !== 4) return null;
        const bbox = value.map(Number);
        if (bbox.some((item) => !Number.isFinite(item))) return null;
        if (bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) return null;
        return [
            clamp(bbox[0], 0, 1),
            clamp(bbox[1], 0, 1),
            clamp(bbox[2], 0, 1),
            clamp(bbox[3], 0, 1),
        ];
    }

    function sourceBbox(slot) {
        return normalizeBbox(slot?.dataset?.readerSourceBbox || null);
    }

    function elementNodeType(element) {
        return String(element?.node?.node_type || '').trim().toLowerCase();
    }

    function elementNodeId(element) {
        return String(element?.node?.node_id || element?.node_id || '').trim();
    }

    function elementParentRef(element) {
        return String(element?.node?.parent_ref || '').trim();
    }

    function positionedPageElements(page) {
        return (page?.elements || []).filter((element) => normalizeBbox(element?.normalized_bbox));
    }

    function visualCaptionAssociations(page) {
        const elements = positionedPageElements(page);
        const byNodeId = new Map();
        elements.forEach((element, index) => {
            const nodeId = elementNodeId(element);
            if (nodeId) byNodeId.set(nodeId, { element, index });
        });

        const byParent = new Map();
        elements.forEach((element, index) => {
            if (elementNodeType(element) !== 'caption') return;
            const parentRef = elementParentRef(element);
            if (!parentRef) return;
            const parent = byNodeId.get(parentRef);
            if (!parent || !VISUAL_CAPTION_PARENT_TYPES.has(elementNodeType(parent.element))) return;
            if (!byParent.has(parentRef)) {
                byParent.set(parentRef, {
                    parentNodeId: parentRef,
                    parentIndex: parent.index,
                    parentElement: parent.element,
                    captions: [],
                });
            }
            byParent.get(parentRef).captions.push({
                captionIndex: index,
                captionElement: element,
            });
        });

        return [...byParent.values()]
            .map((group) => ({
                ...group,
                captions: group.captions.slice().sort((left, right) => left.captionIndex - right.captionIndex),
            }))
            .sort((left, right) => left.parentIndex - right.parentIndex);
    }

    function computeInlineRowBboxes(boxes, shellWidth, minimumGapPx = INLINE_ROW_MIN_GAP_PX) {
        const width = Math.max(1, Number(shellWidth) || 1);
        const gap = Math.max(0, Number(minimumGapPx) || 0) / width;
        const indexed = (boxes || [])
            .map((bbox, index) => ({ index, bbox: normalizeBbox(bbox) }))
            .filter((entry) => entry.bbox)
            .sort((left, right) => left.bbox[0] - right.bbox[0]);
        const result = new Array(boxes?.length || 0).fill(null);
        let previousRight = null;
        for (const entry of indexed) {
            const [rawLeft, top, rawRight, bottom] = entry.bbox;
            let left = rawLeft;
            let right = rawRight;
            if (previousRight !== null && left < previousRight + gap) {
                left = previousRight + gap;
                if (right <= left) right = Math.min(1, left + Math.max(0.02, rawRight - rawLeft));
            }
            left = clamp(left, 0, 0.98);
            right = clamp(Math.max(right, left + 0.01), left + 0.01, 1);
            result[entry.index] = [left, top, right, bottom];
            previousRight = right;
        }
        return result;
    }

    function findShell(section) {
        return section?.querySelector?.('.reader-v2-semantic-page-shell') || section?.children?.[1] || null;
    }

    function findCanvas(section) {
        return section?.querySelector?.('.reader-v2-semantic-page-canvas') || findShell(section)?.children?.[0] || null;
    }

    function applyInlineRowClearance(section) {
        const shell = findShell(section);
        const canvas = findCanvas(section);
        if (!shell || !canvas) return 0;
        const width = Number(shell.clientWidth || shell.offsetWidth || canvas.clientWidth || canvas.offsetWidth || 0);
        const slots = Array.from(canvas.children || []).filter((slot) => slot?.dataset?.readerInlineRow);
        const groups = new Map();
        for (const slot of slots) {
            const row = slot.dataset.readerInlineRow;
            if (!groups.has(row)) groups.set(row, []);
            groups.get(row).push(slot);
        }
        let polished = 0;
        for (const members of groups.values()) {
            if (members.length < 2) continue;
            const boxes = members.map(sourceBbox);
            if (boxes.some((bbox) => !bbox)) continue;
            const adjusted = computeInlineRowBboxes(boxes, width || 800);
            adjusted.forEach((bbox, index) => {
                if (!bbox) return;
                const slot = members[index];
                slot.style.left = `${bbox[0] * 100}%`;
                slot.style.width = `${(bbox[2] - bbox[0]) * 100}%`;
                slot.dataset.readerInlineRowClearance = '1';
            });
            polished += 1;
        }
        if (polished) section.dataset.readerInlineRowClearanceCount = String(polished);
        return polished;
    }

    function styleTopPx(slot) {
        const value = Number.parseFloat(String(slot?.style?.top || ''));
        return Number.isFinite(value) ? value : null;
    }

    function measuredSlotHeight(slot, fallback = 0) {
        const child = slot?.firstElementChild || slot?.children?.[0] || null;
        const values = [slot?.offsetHeight, slot?.scrollHeight, child?.offsetHeight, child?.scrollHeight]
            .map(Number)
            .filter((value) => Number.isFinite(value) && value > 0);
        return values.length ? Math.max(...values) : Math.max(0, Number(fallback) || 0);
    }

    function captionInsertionPlan(parentBottomPx, captionTopPx, captionHeightPx, gapPx = VISUAL_CAPTION_GAP_PX) {
        const parentBottom = Number(parentBottomPx);
        const captionTop = Number(captionTopPx);
        const captionHeight = Math.max(0, Number(captionHeightPx) || 0);
        const gap = Math.max(0, Number(gapPx) || 0);
        if (!Number.isFinite(parentBottom) || !Number.isFinite(captionTop)) return null;
        const desiredTop = parentBottom + gap;
        const separatedDownstream = captionTop > desiredTop + 1;
        return {
            desiredTop,
            shiftPx: separatedDownstream ? captionHeight + gap : 0,
            separatedDownstream,
        };
    }

    function alignCaptionHorizontally(parentSlot, captionSlot) {
        if (!parentSlot || !captionSlot) return false;
        if (parentSlot.style?.left) captionSlot.style.left = parentSlot.style.left;
        if (parentSlot.style?.width) captionSlot.style.width = parentSlot.style.width;
        captionSlot.style.height = 'auto';
        captionSlot.style.overflow = 'visible';
        captionSlot.style.textAlign = 'center';
        const child = captionSlot.firstElementChild || captionSlot.children?.[0] || null;
        if (child?.style) {
            child.style.height = 'auto';
            child.style.overflow = 'visible';
            child.style.textAlign = 'center';
        }
        const text = child?.querySelector?.('.reader-v2-node-text') || null;
        if (text?.style) text.style.textAlign = 'center';
        if (captionSlot.classList?.remove) captionSlot.classList.remove('reader-v2-semantic-page-element--inline-row-member');
        if (captionSlot.dataset) delete captionSlot.dataset.readerInlineRow;
        return true;
    }

    function applyVisualCaptionGrouping(section, page) {
        const shell = findShell(section);
        const canvas = findCanvas(section);
        if (!shell || !canvas || !page) return 0;
        const elements = positionedPageElements(page);
        const slots = Array.from(canvas.children || []);
        if (!elements.length || slots.length < elements.length) return 0;
        const associations = visualCaptionAssociations(page);
        if (!associations.length) return 0;
        const baseHeight = canonicalFurnitureBaseHeight(section, shell);
        let grouped = 0;

        for (const association of associations) {
            const parentSlot = slots[association.parentIndex];
            if (!parentSlot) continue;
            const parentTop = styleTopPx(parentSlot);
            if (parentTop === null) continue;
            let anchorBottom = slotBottomPx(parentSlot, baseHeight);
            if (!(anchorBottom > parentTop)) continue;

            const groupCaptionIndices = new Set(association.captions.map((item) => item.captionIndex));
            let attached = 0;
            for (const caption of association.captions) {
                const captionSlot = slots[caption.captionIndex];
                if (!captionSlot) continue;
                const oldCaptionTop = styleTopPx(captionSlot);
                if (oldCaptionTop === null || oldCaptionTop <= parentTop) continue;
                const fallbackHeight = sourceBbox(captionSlot)
                    ? (sourceBbox(captionSlot)[3] - sourceBbox(captionSlot)[1]) * baseHeight
                    : 0;
                const captionHeight = measuredSlotHeight(captionSlot, fallbackHeight);
                const plan = captionInsertionPlan(anchorBottom, oldCaptionTop, captionHeight);
                if (!plan) continue;

                if (plan.separatedDownstream && plan.shiftPx > 0) {
                    slots.forEach((slot, index) => {
                        if (index === association.parentIndex || groupCaptionIndices.has(index)) return;
                        const type = String(slot?.dataset?.readerNodeType || '');
                        if (FURNITURE_TYPES.has(type)) return;
                        const top = styleTopPx(slot);
                        if (top === null || top <= parentTop + 0.5 || top >= oldCaptionTop - 0.5) return;
                        slot.style.top = `${Math.round((top + plan.shiftPx) * 100) / 100}px`;
                        slot.dataset.readerVisualCaptionDisplaced = association.parentNodeId;
                    });
                }

                alignCaptionHorizontally(parentSlot, captionSlot);
                captionSlot.style.top = `${Math.round(plan.desiredTop * 100) / 100}px`;
                captionSlot.dataset.readerVisualCaptionParent = association.parentNodeId;
                captionSlot.dataset.readerVisualCaptionGrouped = '1';
                anchorBottom = plan.desiredTop + captionHeight;
                attached += 1;
            }
            if (attached) {
                parentSlot.dataset.readerVisualCaptionCount = String(attached);
                grouped += attached;
            }
        }

        if (grouped) section.dataset.readerVisualCaptionGroupedCount = String(grouped);
        return grouped;
    }

    function shellAspectRatio(shell) {
        const inline = Number.parseFloat(String(shell?.style?.aspectRatio || ''));
        if (Number.isFinite(inline) && inline > 0) return inline;
        return null;
    }

    function canonicalFurnitureBaseHeight(section, shell) {
        const width = Number(shell?.clientWidth || shell?.offsetWidth || 0);
        const aspect = shellAspectRatio(shell);
        if (width > 0 && aspect > 0) return width / aspect;
        const stored = Number(section?.dataset?.readerLayoutBaseHeight);
        if (stored > 0) return stored;
        return Number(shell?.clientHeight || shell?.offsetHeight || 900) || 900;
    }

    function expandedHeaderBbox(value, requiredWidthNormalized, pageEdge = HEADER_PAGE_EDGE) {
        const bbox = normalizeBbox(value);
        if (!bbox) return null;
        const edge = clamp(Number(pageEdge) || 0, 0, 0.20);
        const available = Math.max(0.02, 1 - (2 * edge));
        const sourceWidth = bbox[2] - bbox[0];
        const targetWidth = clamp(
            Math.max(sourceWidth, Number(requiredWidthNormalized) || sourceWidth),
            sourceWidth,
            available,
        );
        if (targetWidth <= sourceWidth + 1e-9) return bbox;

        const center = (bbox[0] + bbox[2]) / 2;
        let left;
        if (center <= 0.35) {
            left = bbox[0];
        } else if (center >= 0.65) {
            left = bbox[2] - targetWidth;
        } else {
            left = center - (targetWidth / 2);
        }
        left = clamp(left, edge, Math.max(edge, 1 - edge - targetWidth));
        return [left, bbox[1], left + targetWidth, bbox[3]];
    }

    function headerMeasuredWidthPx(slot) {
        const child = slot?.firstElementChild || slot?.children?.[0] || null;
        const text = child?.querySelector?.('.reader-v2-node-text') || null;
        const values = [slot?.scrollWidth, child?.scrollWidth, text?.scrollWidth]
            .map(Number)
            .filter((value) => Number.isFinite(value) && value > 0);
        return values.length ? Math.max(...values) : 0;
    }

    function normalizeHeaderSlot(slot, shell, baseHeight) {
        const bbox = sourceBbox(slot);
        const shellWidth = Number(shell?.clientWidth || shell?.offsetWidth || 0);
        if (!slot || !bbox || !(shellWidth > 0) || !(baseHeight > 0)) return false;

        const child = slot.firstElementChild || slot.children?.[0] || null;
        const text = child?.querySelector?.('.reader-v2-node-text') || null;
        slot.style.top = `${Math.round(bbox[1] * baseHeight * 100) / 100}px`;
        slot.style.left = `${bbox[0] * 100}%`;
        slot.style.width = `${(bbox[2] - bbox[0]) * 100}%`;
        slot.style.height = 'auto';
        slot.style.overflow = 'visible';
        slot.style.whiteSpace = 'nowrap';
        if (child?.style) {
            child.style.height = 'auto';
            child.style.overflow = 'visible';
            child.style.whiteSpace = 'nowrap';
        }
        if (text?.style) {
            text.style.whiteSpace = 'nowrap';
            text.style.overflowWrap = 'normal';
            text.style.wordBreak = 'keep-all';
        }

        const requiredPx = headerMeasuredWidthPx(slot) + HEADER_HORIZONTAL_PADDING_PX;
        const expanded = expandedHeaderBbox(bbox, requiredPx / shellWidth);
        if (expanded) {
            slot.style.left = `${expanded[0] * 100}%`;
            slot.style.width = `${(expanded[2] - expanded[0]) * 100}%`;
            slot.dataset.readerHeaderHorizontalBbox = expanded.join(',');
        }
        slot.dataset.readerHeaderCanonicalTop = '1';
        slot.dataset.readerHeaderSingleLine = '1';
        return true;
    }

    function normalizeHeaders(section) {
        const shell = findShell(section);
        const canvas = findCanvas(section);
        if (!shell || !canvas) return 0;
        const baseHeight = canonicalFurnitureBaseHeight(section, shell);
        section.dataset.readerLayoutBaseHeight = String(Math.round(baseHeight * 100) / 100);
        const headers = Array.from(canvas.children || [])
            .filter((slot) => slot?.dataset?.readerNodeType === 'header');
        let normalized = 0;
        for (const header of headers) {
            if (normalizeHeaderSlot(header, shell, baseHeight)) normalized += 1;
        }
        if (normalized) section.dataset.readerHeaderNormalizedCount = String(normalized);
        return normalized;
    }

    function slotBottomPx(slot, baseHeight) {
        const top = styleTopPx(slot);
        const offsetHeight = Number(slot?.offsetHeight);
        const scrollHeight = Number(slot?.scrollHeight);
        const measuredHeight = Math.max(
            Number.isFinite(offsetHeight) ? offsetHeight : 0,
            Number.isFinite(scrollHeight) ? scrollHeight : 0,
        );
        if (top !== null && measuredHeight > 0) return top + measuredHeight;
        const offsetTop = Number(slot?.offsetTop);
        if (Number.isFinite(offsetTop) && measuredHeight > 0) return offsetTop + measuredHeight;
        const bbox = sourceBbox(slot);
        return bbox ? bbox[3] * baseHeight : 0;
    }

    function headerShiftDelta(headerBottomPx, firstContentTopPx, gapPx = HEADER_BODY_GAP_PX) {
        const headerBottom = Math.max(0, Number(headerBottomPx) || 0);
        const contentTop = Math.max(0, Number(firstContentTopPx) || 0);
        const safeTop = headerBottom + Math.max(0, Number(gapPx) || 0);
        return Math.max(0, safeTop - contentTop);
    }

    function applyHeaderClearance(section) {
        const shell = findShell(section);
        const canvas = findCanvas(section);
        if (!shell || !canvas) return 0;
        const baseHeight = canonicalFurnitureBaseHeight(section, shell);
        const slots = Array.from(canvas.children || []);
        const headers = slots.filter((slot) => slot?.dataset?.readerNodeType === 'header');
        if (!headers.length) return 0;
        const flow = slots.filter((slot) => {
            const type = String(slot?.dataset?.readerNodeType || '');
            return !FURNITURE_TYPES.has(type) && styleTopPx(slot) !== null;
        });
        if (!flow.length) return 0;
        const headerBottom = Math.max(...headers.map((slot) => slotBottomPx(slot, baseHeight)), 0);
        const firstTop = Math.min(...flow.map(styleTopPx).filter(Number.isFinite));
        const delta = headerShiftDelta(headerBottom, firstTop);
        if (!(delta > 0)) return 0;
        for (const slot of flow) {
            const top = styleTopPx(slot);
            if (top === null) continue;
            slot.style.top = `${Math.round((top + delta) * 100) / 100}px`;
            slot.dataset.readerHeaderClearance = '1';
        }
        const currentHeight = Number.parseFloat(String(shell.style.height || ''))
            || Number(section?.dataset?.readerLayoutHeight)
            || baseHeight;
        if (currentHeight > 0) shell.style.height = `${Math.ceil(currentHeight + delta)}px`;
        section.dataset.readerHeaderClearancePx = String(Math.round(delta * 100) / 100);
        section.dataset.readerLayoutHeight = String(Math.round(currentHeight + delta));
        return delta;
    }

    function polishSection(section, page) {
        if (!section || section?.dataset?.readerLayoutRefined !== '1') return false;
        applyInlineRowClearance(section);
        applyVisualCaptionGrouping(section, page);
        normalizeHeaders(section);
        applyHeaderClearance(section);
        section.dataset.readerLayoutEdgePolished = '1';
        return true;
    }

    function scheduleAfterLayout(root, callback) {
        const schedule = typeof root?.requestAnimationFrame === 'function'
            ? root.requestAnimationFrame.bind(root)
            : (fn) => (root?.setTimeout || setTimeout)(fn, 0);
        schedule(() => schedule(() => schedule(callback)));
    }

    function observeResize(root, section, page) {
        const ResizeObserverCtor = root?.ResizeObserver;
        const shell = findShell(section);
        if (!ResizeObserverCtor || !shell || shell.__readerSemanticEdgePolishObserver) return false;
        let lastWidth = Number(shell.clientWidth || shell.offsetWidth || 0);
        const observer = new ResizeObserverCtor(() => {
            const width = Number(shell.clientWidth || shell.offsetWidth || 0);
            if (!width || Math.abs(width - lastWidth) < 1) return;
            lastWidth = width;
            scheduleAfterLayout(root, () => polishSection(section, page));
        });
        observer.observe(shell);
        shell.__readerSemanticEdgePolishObserver = observer;
        return true;
    }

    function patchSemanticRenderer(root) {
        const SemanticPage = root?.ReaderSemanticPageV2;
        if (!SemanticPage?.renderSemanticPage || !SemanticPage.__readerLayoutRefinementInstalled) return false;
        if (SemanticPage.__readerLayoutEdgePolishInstalled) return true;
        const original = SemanticPage.renderSemanticPage;
        SemanticPage.renderSemanticPage = function renderSemanticPageWithEdgePolish(options = {}) {
            const section = original.call(this, options);
            const page = options.page;
            if (section) {
                scheduleAfterLayout(root, () => {
                    polishSection(section, page);
                    observeResize(root, section, page);
                });
            }
            return section;
        };
        SemanticPage.__readerLayoutEdgePolishInstalled = true;
        SemanticPage.__readerLayoutEdgePolishOriginalRender = original;
        return true;
    }

    function install(options = {}) {
        const root = options.root || (typeof globalThis !== 'undefined' ? globalThis : null);
        if (!root) return false;
        if (patchSemanticRenderer(root)) return true;
        if (root.__readerLayoutEdgePolishRetryScheduled) return false;
        root.__readerLayoutEdgePolishRetryScheduled = true;
        let attempts = 0;
        function retry() {
            attempts += 1;
            if (patchSemanticRenderer(root) || attempts >= INSTALL_MAX_ATTEMPTS) {
                root.__readerLayoutEdgePolishRetryScheduled = false;
                return;
            }
            (root.setTimeout || setTimeout)(retry, INSTALL_RETRY_MS);
        }
        retry();
        return false;
    }

    return {
        HEADER_BODY_GAP_PX,
        HEADER_HORIZONTAL_PADDING_PX,
        HEADER_PAGE_EDGE,
        INLINE_ROW_MIN_GAP_PX,
        VISUAL_CAPTION_GAP_PX,
        alignCaptionHorizontally,
        applyHeaderClearance,
        applyInlineRowClearance,
        applyVisualCaptionGrouping,
        canonicalFurnitureBaseHeight,
        captionInsertionPlan,
        computeInlineRowBboxes,
        expandedHeaderBbox,
        headerMeasuredWidthPx,
        headerShiftDelta,
        install,
        normalizeBbox,
        normalizeHeaderSlot,
        normalizeHeaders,
        patchSemanticRenderer,
        polishSection,
        sourceBbox,
        visualCaptionAssociations,
    };
});