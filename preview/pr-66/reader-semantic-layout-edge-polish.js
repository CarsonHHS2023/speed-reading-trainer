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
    const HEADER_COMPANION_MAX_TOP = 0.18;
    const HEADER_COMPANION_MAX_WIDTH = 0.16;
    const HEADER_COMPANION_MAX_CENTER_DISTANCE = 0.08;
    const HEADER_COMPANION_TYPES = new Set(['paragraph', 'reference', 'unknown']);
    const HEADER_PAGE_NUMBER_PATTERN = /^[\s·•∙⋅\-–—]*\d{1,4}[\s·•∙⋅\-–—]*$/u;
    const FURNITURE_TYPES = new Set(['header', 'footer', 'footnote']);

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

    function presentationNodeType(element) {
        return String(element?.node?.node_type || '').toLowerCase();
    }

    function presentationText(element) {
        const value = element?.display_text === null || element?.display_text === undefined
            ? element?.node?.text
            : element.display_text;
        return String(value || '').trim();
    }

    function isHeaderPageNumberText(value) {
        const text = String(value || '').trim();
        return Boolean(text && HEADER_PAGE_NUMBER_PATTERN.test(text));
    }

    function headerBandForPage(page) {
        const headers = (page?.elements || [])
            .filter((element) => presentationNodeType(element) === 'header')
            .map((element) => normalizeBbox(element?.normalized_bbox))
            .filter(Boolean);
        if (!headers.length) return null;
        const top = Math.min(...headers.map((bbox) => bbox[1]));
        const bottom = Math.max(...headers.map((bbox) => bbox[3]));
        const centers = headers.map((bbox) => (bbox[1] + bbox[3]) / 2).sort((a, b) => a - b);
        const middle = Math.floor(centers.length / 2);
        const center = centers.length % 2
            ? centers[middle]
            : (centers[middle - 1] + centers[middle]) / 2;
        return { top, bottom, center };
    }

    function shouldPromoteHeaderCompanion(element, band) {
        if (!band) return false;
        const type = presentationNodeType(element);
        const bbox = normalizeBbox(element?.normalized_bbox);
        if (!bbox || !HEADER_COMPANION_TYPES.has(type)) return false;
        if (!isHeaderPageNumberText(presentationText(element))) return false;
        if (bbox[1] > HEADER_COMPANION_MAX_TOP) return false;
        if (bbox[2] - bbox[0] > HEADER_COMPANION_MAX_WIDTH) return false;
        const center = (bbox[1] + bbox[3]) / 2;
        return Math.abs(center - band.center) <= HEADER_COMPANION_MAX_CENTER_DISTANCE;
    }

    function promoteHeaderCompanionsInPage(page) {
        const band = headerBandForPage(page);
        if (!band || !Array.isArray(page?.elements)) return page;
        let promoted = 0;
        const elements = page.elements.map((element) => {
            if (!shouldPromoteHeaderCompanion(element, band)) return element;
            const node = element?.node;
            if (!node) return element;
            const originalType = presentationNodeType(element);
            promoted += 1;
            return {
                ...element,
                presentation_header_companion: 'page_number',
                node: {
                    ...node,
                    node_type: 'header',
                    metadata: {
                        ...(node.metadata || {}),
                        presentation_header_companion: 'page_number',
                        presentation_original_node_type: originalType,
                    },
                },
            };
        });
        if (!promoted) return page;
        return {
            ...page,
            elements,
            presentation_header_companion_count: promoted,
        };
    }

    function sourceBbox(slot) {
        return normalizeBbox(slot?.dataset?.readerSourceBbox || null);
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

    function polishSection(section) {
        if (!section || section?.dataset?.readerLayoutRefined !== '1') return false;
        applyInlineRowClearance(section);
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

    function observeResize(root, section) {
        const ResizeObserverCtor = root?.ResizeObserver;
        const shell = findShell(section);
        if (!ResizeObserverCtor || !shell || shell.__readerSemanticEdgePolishObserver) return false;
        let lastWidth = Number(shell.clientWidth || shell.offsetWidth || 0);
        const observer = new ResizeObserverCtor(() => {
            const width = Number(shell.clientWidth || shell.offsetWidth || 0);
            if (!width || Math.abs(width - lastWidth) < 1) return;
            lastWidth = width;
            scheduleAfterLayout(root, () => polishSection(section));
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
            const displayPage = promoteHeaderCompanionsInPage(options.page);
            const renderOptions = displayPage === options.page ? options : { ...options, page: displayPage };
            const section = original.call(this, renderOptions);
            if (section) {
                scheduleAfterLayout(root, () => {
                    polishSection(section);
                    observeResize(root, section);
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
        HEADER_COMPANION_MAX_CENTER_DISTANCE,
        HEADER_COMPANION_MAX_TOP,
        HEADER_COMPANION_MAX_WIDTH,
        HEADER_HORIZONTAL_PADDING_PX,
        HEADER_PAGE_EDGE,
        INLINE_ROW_MIN_GAP_PX,
        applyHeaderClearance,
        applyInlineRowClearance,
        canonicalFurnitureBaseHeight,
        computeInlineRowBboxes,
        expandedHeaderBbox,
        headerBandForPage,
        headerMeasuredWidthPx,
        headerShiftDelta,
        install,
        isHeaderPageNumberText,
        normalizeBbox,
        normalizeHeaderSlot,
        normalizeHeaders,
        patchSemanticRenderer,
        polishSection,
        presentationNodeType,
        presentationText,
        promoteHeaderCompanionsInPage,
        shouldPromoteHeaderCompanion,
        sourceBbox,
    };
});
