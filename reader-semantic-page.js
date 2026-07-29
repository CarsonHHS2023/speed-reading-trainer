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
            height: `${(y2 - y1) * 100}%`,
        };
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

    function createElement(documentObject, tag, className, text) {
        const element = documentObject.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined && text !== null) element.textContent = text;
        return element;
    }

    function applyStyle(element, style) {
        for (const [name, value] of Object.entries(style || {})) element.style[name] = value;
    }

    function nodeForElement(element) {
        if (element?.display_text === null || element?.display_text === undefined) return element?.node;
        return {
            ...element.node,
            node_id: `${element.node_id}:page-fragment:${element.fragment_index ?? 0}`,
            text: element.display_text,
            presentation_canonical_node_id: element.node_id,
            presentation_fragment_index: element.fragment_index ?? 0,
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

    function renderSemanticPage(options = {}) {
        const {
            documentObject,
            page,
            renderNode,
            pageNumber,
            pageNumberLabel,
        } = options;
        if (!documentObject || !page || typeof renderNode !== 'function') return null;

        const section = createElement(documentObject, 'section', 'reader-v2-page reader-v2-page-semantic_full_page');
        section.dataset.presentationId = page.presentation_id;
        section.dataset.sourceUnitId = page.source_unit_id || '';

        const resolvedLabel = pageNumberLabel || `第 ${Number(pageNumber ?? page.source_order) + 1} 页`;
        const label = createElement(documentObject, 'div', 'reader-v2-page-label', resolvedLabel);
        section.appendChild(label);

        const shell = createElement(documentObject, 'div', 'reader-v2-semantic-page-shell');
        shell.style.aspectRatio = String(pageAspectRatio(page.source_unit));
        section.appendChild(shell);

        const canvas = createElement(documentObject, 'div', 'reader-v2-semantic-page-canvas');
        shell.appendChild(canvas);

        const { positioned, fallback } = partitionElements(page.elements || []);
        for (const element of positioned) {
            const slot = createElement(documentObject, 'div', 'reader-v2-semantic-page-element');
            slot.dataset.readerElementId = element.element_id || '';
            slot.dataset.readerNodeId = element.node_id || '';
            applyStyle(slot, spatialStyle(element.normalized_bbox));
            const rendered = renderElementNode(element, renderNode);
            if (rendered) slot.appendChild(rendered);
            canvas.appendChild(slot);
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
        DEFAULT_PAGE_ASPECT_RATIO,
        nodeForElement,
        normalizeBbox,
        pageAspectRatio,
        partitionElements,
        renderElementNode,
        renderSemanticPage,
        spatialStyle,
    };
});