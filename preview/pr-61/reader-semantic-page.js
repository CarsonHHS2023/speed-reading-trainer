(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderSemanticPageV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const DEFAULT_PAGE_ASPECT_RATIO = 1 / Math.sqrt(2);

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

    function spatialStyle(normalizedBbox) {
        const bbox = normalizeBbox(normalizedBbox);
        if (!bbox) return null;
        const [x1, y1, x2, y2] = bbox;
        return {
            left: `${x1 * 100}%`,
            top: `${y1 * 100}%`,
            width: `${(x2 - x1) * 100}%`,
            minHeight: `${(y2 - y1) * 100}%`,
        };
    }

    function pageAspectRatio(sourceUnit) {
        const width = Number(sourceUnit?.width || sourceUnit?.page_width);
        const height = Number(sourceUnit?.height || sourceUnit?.page_height);
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

    function createElement(documentObject, tag, className, text) {
        const element = documentObject.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined && text !== null) element.textContent = text;
        return element;
    }

    function applyStyle(element, style) {
        for (const [name, value] of Object.entries(style || {})) element.style[name] = value;
    }

    function renderSemanticPage(options = {}) {
        const {
            documentObject,
            page,
            renderNode,
            pageNumber,
        } = options;
        if (!documentObject || !page || typeof renderNode !== 'function') return null;

        const section = createElement(documentObject, 'section', 'reader-v2-page reader-v2-page-semantic_full_page');
        section.dataset.presentationId = page.presentation_id;
        section.dataset.sourceUnitId = page.source_unit_id || '';

        const label = createElement(documentObject, 'div', 'reader-v2-page-label', `第 ${Number(pageNumber ?? page.source_order) + 1} 页`);
        section.appendChild(label);

        const canvas = createElement(documentObject, 'div', 'reader-v2-semantic-page-canvas');
        canvas.style.aspectRatio = String(pageAspectRatio(page.source_unit));
        section.appendChild(canvas);

        const { positioned, fallback } = partitionElements(page.elements || []);
        for (const element of positioned) {
            const slot = createElement(documentObject, 'div', 'reader-v2-semantic-page-element');
            slot.dataset.readerElementId = element.element_id || '';
            slot.dataset.readerNodeId = element.node_id || '';
            applyStyle(slot, spatialStyle(element.normalized_bbox));
            slot.appendChild(renderNode(element.node));
            canvas.appendChild(slot);
        }

        if (fallback.length) {
            const flow = createElement(documentObject, 'div', 'reader-v2-semantic-page-fallback');
            flow.dataset.fallbackCount = String(fallback.length);
            for (const element of fallback) flow.appendChild(renderNode(element.node));
            section.appendChild(flow);
        }

        return section;
    }

    return {
        DEFAULT_PAGE_ASPECT_RATIO,
        normalizeBbox,
        pageAspectRatio,
        partitionElements,
        renderSemanticPage,
        spatialStyle,
    };
});
