(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderSemanticPageV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const DEFAULT_PAGE_ASPECT_RATIO = 1 / Math.sqrt(2);
    const DEFAULT_TEXT_RIGHT_EDGE = 0.94;
    const DEFAULT_TEXT_MARGIN_LEFT = 0.10;
    const DEFAULT_TEXT_MARGIN_RIGHT = 0.90;
    const MIN_BODY_FRAME_WIDTH = 0.55;
    const MIN_TEXT_FRAME_SCALE = 0.80;
    const MAX_TEXT_FRAME_SCALE = 1.30;
    const OVERFLOW_TOLERANCE_PX = 1;
    const PROVIDER_DEBUG_FIELD = /^\s*(?:label|bbox|content)\s*:\s*.*$/i;
    const VISUAL_NODE_TYPES = new Set(['figure', 'table', 'formula']);
    const BODY_FRAME_CANDIDATE_TYPES = new Set([
        'paragraph', 'list_item', 'quote', 'code', 'reference',
    ]);
    const TEXT_MARGIN_NORMALIZED_TYPES = new Set([
        'heading', 'paragraph', 'list', 'list_item', 'quote', 'code', 'reference',
    ]);
    const SOURCE_POSITIONED_TEXT_TYPES = new Set([
        'header', 'footer', 'footnote', 'caption',
    ]);

    function clamp01(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return null;
        return Math.min(1, Math.max(0, number));
    }

    function normalizeBbox(value) {
        if (!Array.isArray(value) || value.length !== 4) return null;
        const coordinates = value.map(clamp01);
        if (coordinates.some((item) => item === null)) return null;
        const [x1, y1, x2, y2] = coordinates;
        if (x2 <= x1 || y2 <= y1) return null;
        return [x1, y1, x2, y2];
    }

    function elementNodeType(element) {
        return String(element?.node?.node_type || '').toLowerCase();
    }

    function isVisualElement(element) {
        return VISUAL_NODE_TYPES.has(elementNodeType(element));
    }

    function isCoverSourceRendering(page, element) {
        return page?.presentation_mode === 'source_rendering'
            && page?.page_kind === 'cover'
            && element?.kind === 'cover_source_rendering';
    }

    function spatialStyle(normalizedBbox, options = {}) {
        const bbox = normalizeBbox(normalizedBbox);
        if (!bbox) return null;
        const [x1, y1, x2, y2] = bbox;
        const style = {
            left: `${x1 * 100}%`,
            top: `${y1 * 100}%`,
            width: `${(x2 - x1) * 100}%`,
        };
        if (options.constrainHeight !== false) style.height = `${(y2 - y1) * 100}%`;
        return style;
    }

    function pageAspectRatio(sourceUnit) {
        const dimensions = sourceUnit?.dimensions || {};
        const width = Number(dimensions.width ?? sourceUnit?.width ?? sourceUnit?.page_width);
        const height = Number(dimensions.height ?? sourceUnit?.height ?? sourceUnit?.page_height);
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
            return width / height;
        }
        return DEFAULT_PAGE_ASPECT_RATIO;
    }

    function partitionElements(elements) {
        const positioned = [];
        const fallback = [];
        for (const element of elements || []) {
            const bbox = normalizeBbox(element?.normalized_bbox);
            if (bbox) positioned.push({ ...element, normalized_bbox: bbox });
            else fallback.push(element);
        }
        return { positioned, fallback };
    }

    function median(values) {
        const ordered = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
        if (!ordered.length) return null;
        const middle = Math.floor(ordered.length / 2);
        return ordered.length % 2
            ? ordered[middle]
            : (ordered[middle - 1] + ordered[middle]) / 2;
    }

    function isBodyFrameCandidate(element) {
        const bbox = normalizeBbox(element?.normalized_bbox);
        if (!bbox || !BODY_FRAME_CANDIDATE_TYPES.has(elementNodeType(element))) return false;
        return bbox[2] - bbox[0] >= MIN_BODY_FRAME_WIDTH;
    }

    function inferPageTextFrame(elements) {
        const candidates = (elements || []).filter(isBodyFrameCandidate);
        if (!candidates.length) return null;
        const left = median(candidates.map((element) => element.normalized_bbox[0]));
        const right = median(candidates.map((element) => element.normalized_bbox[2]));
        if (!Number.isFinite(left) || !Number.isFinite(right) || right - left < MIN_BODY_FRAME_WIDTH) {
            return null;
        }
        return [left, right];
    }

    function textMarginLayout(page, options = {}) {
        const coverPage = page?.page_kind === 'cover' && page?.presentation_mode === 'source_rendering';
        if (coverPage || options.normalizeTextMargins === false) {
            return { enabled: false, sourceFrame: null, targetFrame: null, scale: 1 };
        }
        const sourceFrame = inferPageTextFrame(page?.elements || []);
        if (!sourceFrame) return { enabled: false, sourceFrame: null, targetFrame: null, scale: 1 };

        const targetLeft = clamp01(options.textMarginLeft ?? DEFAULT_TEXT_MARGIN_LEFT);
        const targetRight = clamp01(options.textMarginRight ?? DEFAULT_TEXT_MARGIN_RIGHT);
        if (
            targetLeft === null
            || targetRight === null
            || targetRight - targetLeft < MIN_BODY_FRAME_WIDTH
        ) {
            return { enabled: false, sourceFrame, targetFrame: null, scale: 1 };
        }

        const scale = (targetRight - targetLeft) / (sourceFrame[1] - sourceFrame[0]);
        if (scale < MIN_TEXT_FRAME_SCALE || scale > MAX_TEXT_FRAME_SCALE) {
            return { enabled: false, sourceFrame, targetFrame: [targetLeft, targetRight], scale };
        }
        return {
            enabled: true,
            sourceFrame,
            targetFrame: [targetLeft, targetRight],
            scale,
        };
    }

    function shouldNormalizeTextElement(element) {
        const nodeType = elementNodeType(element);
        return TEXT_MARGIN_NORMALIZED_TYPES.has(nodeType)
            && !SOURCE_POSITIONED_TEXT_TYPES.has(nodeType)
            && !isVisualElement(element);
    }

    function normalizeTextBbox(normalizedBbox, layout) {
        const bbox = normalizeBbox(normalizedBbox);
        if (!bbox || !layout?.enabled || !layout.sourceFrame || !layout.targetFrame) return bbox;
        const [sourceLeft] = layout.sourceFrame;
        const [targetLeft] = layout.targetFrame;
        const [x1, y1, x2, y2] = bbox;
        let mappedLeft = targetLeft + ((x1 - sourceLeft) * layout.scale);
        let mappedRight = targetLeft + ((x2 - sourceLeft) * layout.scale);
        mappedLeft = Math.max(0.02, Math.min(0.98, mappedLeft));
        mappedRight = Math.max(0.02, Math.min(0.98, mappedRight));
        if (mappedRight <= mappedLeft) return bbox;
        return [mappedLeft, y1, mappedRight, y2];
    }

    function presentationBbox(page, element, layout = textMarginLayout(page)) {
        const bbox = normalizeBbox(element?.normalized_bbox);
        if (!bbox || !shouldNormalizeTextElement(element)) return bbox;
        return normalizeTextBbox(bbox, layout);
    }

    function bboxesEqual(left, right, tolerance = 1e-9) {
        const a = normalizeBbox(left);
        const b = normalizeBbox(right);
        return Boolean(a && b && a.every((value, index) => Math.abs(value - b[index]) <= tolerance));
    }

    function createElement(documentObject, tag, className, text) {
        const element = documentObject.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined && text !== null) element.textContent = text;
        return element;
    }

    function applyStyle(element, style) {
        for (const [name, value] of Object.entries(style || {})) element.style[name] = value;
    }

    function addClass(element, className) {
        if (element?.classList?.add) {
            element.classList.add(className);
            return;
        }
        const classes = new Set(String(element?.className || '').split(/\s+/).filter(Boolean));
        classes.add(className);
        if (element) element.className = [...classes].join(' ');
    }

    function stripProviderDebugFields(value) {
        if (typeof value !== 'string' || !value) return value;
        const lines = value.split(/\r\n|\r|\n/);
        const filtered = lines.filter((line) => !PROVIDER_DEBUG_FIELD.test(line));
        return filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    function nodeForElement(element) {
        const canonical = element?.node;
        if (!canonical) return canonical;
        const sourceText = element?.display_text === null || element?.display_text === undefined
            ? canonical.text
            : element.display_text;
        const displayText = stripProviderDebugFields(sourceText);
        const isFragment = element?.display_text !== null && element?.display_text !== undefined;
        if (!isFragment && displayText === canonical.text) return canonical;
        return {
            ...canonical,
            node_id: isFragment
                ? `${element.node_id}:page-fragment:${element.fragment_index ?? 0}`
                : `${element.node_id}:semantic-display`,
            text: displayText,
            presentation_canonical_node_id: element.node_id,
            presentation_fragment_index: isFragment ? (element.fragment_index ?? 0) : null,
        };
    }

    function renderElementNode(element, renderNode) {
        const rendered = renderNode(nodeForElement(element));
        if (!rendered) return rendered;
        rendered.dataset.readerNodeId = element.node_id || '';
        if (element.fragment_index !== null && element.fragment_index !== undefined) {
            rendered.dataset.readerFragmentIndex = String(element.fragment_index);
        }
        return rendered;
    }

    function elementOverflows(slot) {
        const scrollWidth = Number(slot?.scrollWidth);
        const clientWidth = Number(slot?.clientWidth);
        const scrollHeight = Number(slot?.scrollHeight);
        const clientHeight = Number(slot?.clientHeight);
        if (![scrollWidth, clientWidth, scrollHeight, clientHeight].every(Number.isFinite)) return false;
        return scrollWidth > clientWidth + OVERFLOW_TOLERANCE_PX
            || scrollHeight > clientHeight + OVERFLOW_TOLERANCE_PX;
    }

    function expandTextSlotWidth(slot, normalizedBbox, options = {}) {
        const bbox = normalizeBbox(normalizedBbox);
        if (!slot || !bbox || !elementOverflows(slot)) return false;
        const [x1, , x2] = bbox;
        const rightEdge = Math.max(x2, Math.min(1, Number(options.rightEdge ?? DEFAULT_TEXT_RIGHT_EDGE)));
        if (rightEdge <= x2) return false;
        slot.style.width = `${(rightEdge - x1) * 100}%`;
        addClass(slot, 'reader-v2-semantic-page-element--width-expanded');
        return true;
    }

    function expandTextSlotHeight(slot) {
        if (!slot || !elementOverflows(slot)) return false;
        slot.style.height = 'auto';
        slot.style.overflow = 'visible';
        addClass(slot, 'reader-v2-semantic-page-element--height-expanded');
        return true;
    }

    function adaptOverflowingTextSlot(slot, normalizedBbox, options = {}) {
        if (!slot || !normalizeBbox(normalizedBbox) || !elementOverflows(slot)) return false;
        const schedule = typeof options.schedule === 'function'
            ? options.schedule
            : (callback) => callback();
        const widthExpanded = expandTextSlotWidth(slot, normalizedBbox, options);
        schedule(() => expandTextSlotHeight(slot));
        return widthExpanded || true;
    }

    function layoutScheduler(documentObject, override) {
        if (typeof override === 'function') return override;
        const view = documentObject?.defaultView;
        if (typeof view?.requestAnimationFrame === 'function') return view.requestAnimationFrame.bind(view);
        if (typeof globalThis?.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame.bind(globalThis);
        return null;
    }

    function renderSemanticPage(options = {}) {
        const {
            documentObject,
            page,
            renderNode,
            pageNumber,
            pageNumberLabel,
            scheduleLayout,
        } = options;
        if (!documentObject || !page || typeof renderNode !== 'function') return null;

        const section = createElement(documentObject, 'section', 'reader-v2-page reader-v2-page-semantic_full_page');
        section.dataset.presentationId = page.presentation_id;
        section.dataset.sourceUnitId = page.source_unit_id || '';
        const coverPage = page?.page_kind === 'cover' && page?.presentation_mode === 'source_rendering';
        if (coverPage) addClass(section, 'reader-v2-page--cover-source-rendering');

        const marginLayout = textMarginLayout(page, options);
        section.dataset.readerTextMarginLayout = marginLayout.enabled ? 'normalized' : 'source';
        if (marginLayout.sourceFrame) {
            section.dataset.readerSourceTextFrame = marginLayout.sourceFrame.join(',');
        }
        if (marginLayout.targetFrame) {
            section.dataset.readerTargetTextFrame = marginLayout.targetFrame.join(',');
        }

        const resolvedLabel = pageNumberLabel || `第 ${Number(pageNumber ?? page.source_order) + 1} 页`;
        const label = createElement(documentObject, 'div', 'reader-v2-page-label', resolvedLabel);
        section.appendChild(label);

        const shell = createElement(documentObject, 'div', 'reader-v2-semantic-page-shell');
        shell.style.aspectRatio = String(pageAspectRatio(page.source_unit));
        if (coverPage) addClass(shell, 'reader-v2-semantic-page-shell--cover');
        section.appendChild(shell);

        const canvas = createElement(documentObject, 'div', 'reader-v2-semantic-page-canvas');
        shell.appendChild(canvas);
        const schedule = layoutScheduler(documentObject, scheduleLayout);

        const { positioned, fallback } = partitionElements(page.elements || []);
        for (const element of positioned) {
            const visual = isVisualElement(element);
            const coverElement = isCoverSourceRendering(page, element);
            const displayBbox = presentationBbox(page, element, marginLayout);
            const slot = createElement(
                documentObject,
                'div',
                `reader-v2-semantic-page-element reader-v2-semantic-page-element--${visual ? 'visual' : 'text'}`,
            );
            if (coverElement) addClass(slot, 'reader-v2-semantic-page-element--cover-source-rendering');
            if (!bboxesEqual(displayBbox, element.normalized_bbox)) {
                addClass(slot, 'reader-v2-semantic-page-element--margin-normalized');
                slot.dataset.readerSourceBbox = element.normalized_bbox.join(',');
                slot.dataset.readerPresentationBbox = displayBbox.join(',');
            }
            slot.dataset.readerElementId = element.element_id || '';
            slot.dataset.readerNodeId = element.node_id || '';
            applyStyle(slot, spatialStyle(displayBbox, { constrainHeight: true }));
            const rendered = renderElementNode(element, renderNode);
            if (rendered) slot.appendChild(rendered);
            canvas.appendChild(slot);
            if (!visual && schedule) {
                const rightEdge = marginLayout.enabled && marginLayout.targetFrame
                    ? marginLayout.targetFrame[1]
                    : DEFAULT_TEXT_RIGHT_EDGE;
                schedule(() => adaptOverflowingTextSlot(slot, displayBbox, { schedule, rightEdge }));
            }
        }

        if (fallback.length) {
            const flow = createElement(documentObject, 'div', 'reader-v2-semantic-page-fallback');
            flow.dataset.fallbackCount = String(fallback.length);
            for (const element of fallback) {
                const rendered = renderElementNode(element, renderNode);
                if (rendered) flow.appendChild(rendered);
            }
            section.appendChild(flow);
        }

        return section;
    }

    return {
        BODY_FRAME_CANDIDATE_TYPES,
        DEFAULT_PAGE_ASPECT_RATIO,
        DEFAULT_TEXT_MARGIN_LEFT,
        DEFAULT_TEXT_MARGIN_RIGHT,
        DEFAULT_TEXT_RIGHT_EDGE,
        MAX_TEXT_FRAME_SCALE,
        MIN_BODY_FRAME_WIDTH,
        MIN_TEXT_FRAME_SCALE,
        OVERFLOW_TOLERANCE_PX,
        SOURCE_POSITIONED_TEXT_TYPES,
        TEXT_MARGIN_NORMALIZED_TYPES,
        VISUAL_NODE_TYPES,
        adaptOverflowingTextSlot,
        bboxesEqual,
        elementNodeType,
        elementOverflows,
        expandTextSlotHeight,
        expandTextSlotWidth,
        inferPageTextFrame,
        isBodyFrameCandidate,
        isCoverSourceRendering,
        isVisualElement,
        median,
        nodeForElement,
        normalizeBbox,
        normalizeTextBbox,
        pageAspectRatio,
        partitionElements,
        presentationBbox,
        renderElementNode,
        renderSemanticPage,
        shouldNormalizeTextElement,
        spatialStyle,
        stripProviderDebugFields,
        textMarginLayout,
    };
});