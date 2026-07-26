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

    function requireModel() {
        if (!Model && typeof require === 'function') Model = require('./reader-model.js');
        if (!Model) throw new Error('ReaderModelV2 is required');
        return Model;
    }

    function primarySourceUnitId(node) {
        return node?.location?.source_unit_id || node?.source_unit_ids?.[0] || null;
    }

    function derivePhysicalPages(sourceUnits, nodes) {
        const model = requireModel();
        const pages = model.physicalPageSourceUnits(sourceUnits);
        const pageById = new Map(pages.map((unit) => [unit.source_unit_id, {
            presentation_id: `physical:${unit.source_unit_id}`,
            kind: 'physical_page',
            source_unit: unit,
            source_unit_id: unit.source_unit_id,
            source_order: Number(unit.source_order),
            nodes: [],
        }]));
        const unplaced = [];
        for (const node of model.orderedNodes(nodes)) {
            const unitId = primarySourceUnitId(node);
            const page = unitId ? pageById.get(unitId) : null;
            if (page) page.nodes.push(node);
            else unplaced.push(node);
        }
        const result = pages.map((unit) => pageById.get(unit.source_unit_id));
        if (unplaced.length) {
            result.push({
                presentation_id: 'physical:unplaced',
                kind: 'semantic_overflow',
                source_unit: null,
                source_unit_id: null,
                source_order: Number.MAX_SAFE_INTEGER,
                nodes: unplaced,
            });
        }
        return result;
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
        const reflowable = sourceUnits.filter(model.isReflowableSourceUnit);
        if (physical.length && !reflowable.length) {
            return { mode: 'physical', pages: derivePhysicalPages(sourceUnits, nodes) };
        }
        return {
            mode: 'reflow',
            pages: deriveReflowPages(nodes, options),
        };
    }

    function findPresentationPageForNode(pages, nodeId) {
        return (pages || []).find((page) => (page.nodes || []).some((node) => node.node_id === nodeId)) || null;
    }

    return {
        DEFAULT_REFLOW_LINE_WIDTH,
        DEFAULT_REFLOW_MAX_LINES,
        derivePhysicalPages,
        deriveReflowPages,
        effectiveReflowMetrics,
        estimateNodeLines,
        findPresentationPageForNode,
        presentationForDocument,
        primarySourceUnitId,
    };
});
