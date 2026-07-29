(function (root, factory) {
    const api = factory(root && root.ReaderModelV2);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderPresentationV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Model) {
    'use strict';

    const DEFAULT_REFLOW_LINE_WIDTH = 35;
    const DEFAULT_REFLOW_MAX_LINES = 20;
    const DEFAULT_FONT_SIZE = 28;
    const DEFAULT_VIEWPORT_WIDTH = 700;
    const PRESENTATION_MODE_SEMANTIC_FULL_PAGE = 'semantic_full_page';
    const PRESENTATION_MODE_REFLOW = 'reflow';

    function requireModel() {
        if (!Model && typeof require === 'function') Model = require('./reader-model.js');
        if (!Model) throw new Error('ReaderModelV2 is required');
        return Model;
    }

    function primarySourceUnitId(node) {
        return node?.location?.source_unit_id || node?.source_unit_ids?.[0] || null;
    }

    function spatialAnchorForNode(node, sourceUnitId = primarySourceUnitId(node)) {
        const anchors = [];
        if (node?.location?.source_anchor) anchors.push(node.location.source_anchor);
        for (const anchor of node?.source_anchors || []) anchors.push(anchor);
        return anchors.find((anchor) => (
            anchor?.kind === 'spatial'
            && anchor?.source_unit_id === sourceUnitId
            && Array.isArray(anchor?.normalized_bbox)
        )) || null;
    }

    function normalizeBbox(bbox) {
        if (!Array.isArray(bbox) || bbox.length !== 4) return null;
        const values = bbox.map(Number);
        if (values.some((value) => !Number.isFinite(value))) return null;
        const [x1, y1, x2, y2] = values;
        if (x2 <= x1 || y2 <= y1) return null;
        return [
            Math.max(0, Math.min(1, x1)),
            Math.max(0, Math.min(1, y1)),
            Math.max(0, Math.min(1, x2)),
            Math.max(0, Math.min(1, y2)),
        ];
    }

    function normalizedBBoxForNode(node, sourceUnitId = primarySourceUnitId(node)) {
        return normalizeBbox(spatialAnchorForNode(node, sourceUnitId)?.normalized_bbox);
    }

    function pageFragmentsForNode(node) {
        const fragments = node?.metadata?.page_fragments;
        if (!Array.isArray(fragments)) return [];
        return fragments.map((fragment, index) => {
            const sourceUnitId = String(fragment?.source_unit_id || '').trim();
            if (!sourceUnitId) return null;
            const sourceAnchor = fragment?.source_anchor;
            return {
                fragment_index: index,
                source_unit_id: sourceUnitId,
                text: typeof fragment?.text === 'string' ? fragment.text : '',
                normalized_bbox: normalizeBbox(sourceAnchor?.normalized_bbox),
            };
        }).filter(Boolean);
    }

    function semanticElementForNode(node, sourceUnitId = primarySourceUnitId(node), fragment = null) {
        const fragmentSuffix = fragment ? `:fragment:${fragment.fragment_index}` : '';
        return {
            element_id: `node:${node.node_id}${fragmentSuffix}`,
            kind: fragment ? 'semantic_node_fragment' : 'semantic_node',
            node_id: node.node_id,
            node,
            display_text: fragment ? fragment.text : null,
            fragment_index: fragment?.fragment_index ?? null,
            normalized_bbox: fragment?.normalized_bbox || normalizedBBoxForNode(node, sourceUnitId),
            source_unit_id: sourceUnitId,
        };
    }

    function deriveSemanticFullPages(sourceUnits, nodes) {
        const model = requireModel();
        const pages = model.physicalPageSourceUnits(sourceUnits);
        const pageById = new Map(pages.map((unit) => [unit.source_unit_id, {
            presentation_id: `semantic-page:${unit.source_unit_id}`,
            kind: 'semantic_full_page',
            source_unit: unit,
            source_unit_id: unit.source_unit_id,
            source_order: Number(unit.source_order),
            elements: [],
            nodes: [],
        }]));
        const unplaced = [];
        for (const node of model.orderedNodes(nodes)) {
            const fragments = pageFragmentsForNode(node);
            let placedFragment = false;
            for (const fragment of fragments) {
                const page = pageById.get(fragment.source_unit_id);
                if (!page) continue;
                page.nodes.push(node);
                page.elements.push(semanticElementForNode(node, fragment.source_unit_id, fragment));
                placedFragment = true;
            }
            if (placedFragment) continue;

            const unitId = primarySourceUnitId(node);
            const page = unitId ? pageById.get(unitId) : null;
            if (page) {
                page.nodes.push(node);
                page.elements.push(semanticElementForNode(node, unitId));
            } else {
                unplaced.push(node);
            }
        }
        const result = pages.map((unit) => pageById.get(unit.source_unit_id));
        if (unplaced.length) {
            result.push({
                presentation_id: 'semantic-page:unplaced',
                kind: 'semantic_overflow',
                source_unit: null,
                source_unit_id: null,
                source_order: Number.MAX_SAFE_INTEGER,
                nodes: unplaced,
                elements: unplaced.map((node) => semanticElementForNode(node, null)),
            });
        }
        return result;
    }

    // Compatibility alias retained for callers/tests that still use the old name.
    function derivePhysicalPages(sourceUnits, nodes) {
        return deriveSemanticFullPages(sourceUnits, nodes).map((page) => ({
            ...page,
            presentation_id: page.presentation_id.replace('semantic-page:', 'physical:'),
            kind: page.kind === 'semantic_full_page' ? 'physical_page' : page.kind,
        }));
    }

    function effectiveReflowMetrics(options = {}) {
        const requestedWidth = Math.max(5, Number(options.lineWidth || DEFAULT_REFLOW_LINE_WIDTH));
        const requestedLines = Math.max(1, Number(options.maxLines || DEFAULT_REFLOW_MAX_LINES));
        const fontSize = Math.max(10, Number(options.fontSize || DEFAULT_FONT_SIZE));
        const viewportWidth = Math.max(240, Number(options.viewportWidth || DEFAULT_VIEWPORT_WIDTH));
        const widthScale = viewportWidth / DEFAULT_VIEWPORT_WIDTH;
        const fontScale = DEFAULT_FONT_SIZE / fontSize;
        return {
            lineWidth: Math.max(5, Math.floor(requestedWidth * widthScale * fontScale)),
            maxLines: Math.max(1, Math.floor(requestedLines * fontScale)),
        };
    }

    function estimateNodeLines(node, lineWidth) {
        const width = Math.max(5, Number(lineWidth || DEFAULT_REFLOW_LINE_WIDTH));
        const text = typeof node?.text === 'string' ? node.text : '';
        if (!text.trim()) return 1;
        const explicitLines = text.split(/\r\n|\r|\n/);
        let count = 0;
        for (const line of explicitLines) count += Math.max(1, Math.ceil([...line].length / width));
        if (node.node_type === 'heading') count += 1;
        if (node.node_type === 'figure' || node.node_type === 'table' || node.node_type === 'formula') count += 2;
        return Math.max(1, count);
    }

    function deriveReflowPages(nodes, options = {}) {
        const model = requireModel();
        const metrics = effectiveReflowMetrics(options);
        const ordered = model.orderedNodes(nodes);
        const pages = [];
        let current = null;

        function startPage() {
            current = {
                presentation_id: `reflow:${pages.length}`,
                kind: 'reflow_page',
                presentation_order: pages.length,
                estimated_lines: 0,
                nodes: [],
            };
            pages.push(current);
        }

        for (const node of ordered) {
            const lines = estimateNodeLines(node, metrics.lineWidth);
            if (!current) startPage();
            if (current.nodes.length && current.estimated_lines + lines > metrics.maxLines) startPage();
            current.nodes.push(node);
            current.estimated_lines += lines;
        }
        return pages;
    }

    function presentationForDocument(documentView, nodes, options = {}) {
        const model = requireModel();
        const sourceUnits = model.orderedSourceUnits(documentView?.source_units || []);
        const physical = model.physicalPageSourceUnits(sourceUnits);
        if (physical.length) {
            return {
                mode: PRESENTATION_MODE_SEMANTIC_FULL_PAGE,
                pages: deriveSemanticFullPages(sourceUnits, nodes),
            };
        }
        return {
            mode: PRESENTATION_MODE_REFLOW,
            pages: deriveReflowPages(nodes, options),
        };
    }

    function findPresentationPageForNode(pages, nodeId) {
        return (pages || []).find((page) => (page.nodes || []).some((node) => node.node_id === nodeId)) || null;
    }

    return {
        DEFAULT_REFLOW_LINE_WIDTH,
        DEFAULT_REFLOW_MAX_LINES,
        PRESENTATION_MODE_REFLOW,
        PRESENTATION_MODE_SEMANTIC_FULL_PAGE,
        derivePhysicalPages,
        deriveReflowPages,
        deriveSemanticFullPages,
        effectiveReflowMetrics,
        estimateNodeLines,
        findPresentationPageForNode,
        normalizedBBoxForNode,
        pageFragmentsForNode,
        presentationForDocument,
        primarySourceUnitId,
        semanticElementForNode,
        spatialAnchorForNode,
    };
});

(function bootstrapSemanticFullPage(root) {
    'use strict';

    if (!root || typeof document === 'undefined') return;
    if (root.__readerSemanticFullPageBootstrapStarted) return;
    root.__readerSemanticFullPageBootstrapStarted = true;

    function ensureStylesheet(href) {
        const selector = `link[data-reader-semantic-page-css="${href}"]`;
        if (document.querySelector(selector)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.readerSemanticPageCss = href;
        document.head.appendChild(link);
    }

    function loadScriptOnce(src, ready) {
        if (ready()) return Promise.resolve();
        const existing = document.querySelector(`script[data-reader-semantic-page-src="${src}"]`);
        if (existing) {
            return new Promise((resolve, reject) => {
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', reject, { once: true });
            });
        }
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = false;
            script.dataset.readerSemanticPageSrc = src;
            script.addEventListener('load', resolve, { once: true });
            script.addEventListener('error', reject, { once: true });
            document.head.appendChild(script);
        });
    }

    function waitForReady(check, timeoutMs = 10000) {
        const started = Date.now();
        return new Promise((resolve, reject) => {
            function poll() {
                if (check()) {
                    resolve();
                    return;
                }
                if (Date.now() - started >= timeoutMs) {
                    reject(new Error('Reader semantic page bootstrap timed out'));
                    return;
                }
                root.setTimeout(poll, 20);
            }
            poll();
        });
    }

    ensureStylesheet('reader-semantic-page.css');
    loadScriptOnce('reader-semantic-page.js', () => Boolean(root.ReaderSemanticPageV2))
        .then(() => waitForReady(() => Boolean(root.ReaderUIV2?.ReaderV2Controller)))
        .then(() => loadScriptOnce(
            'reader-semantic-page-integration.js',
            () => Boolean(root.ReaderSemanticPageIntegrationV2),
        ))
        .then(() => root.ReaderSemanticPageIntegrationV2.installSemanticPageIntegration())
        .catch((error) => {
            // Keep legacy Reader rendering available if the optional semantic page assets fail.
            if (root.console?.warn) root.console.warn('Semantic full-page Reader bootstrap failed', error);
        });
})(typeof globalThis !== 'undefined' ? globalThis : this);