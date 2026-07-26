(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderModelV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const REFLOWABLE_KINDS = new Set(['text_flow', 'html_section', 'ebook_spine_item', 'document_part']);
    const TEXTUAL_TYPES = new Set([
        'heading', 'paragraph', 'list_item', 'caption', 'formula', 'header', 'footer', 'footnote', 'quote', 'code', 'reference', 'unknown',
    ]);

    function orderedSourceUnits(units) {
        return [...(units || [])].sort((a, b) => {
            const ao = Number(a && a.source_order);
            const bo = Number(b && b.source_order);
            if (ao !== bo) return ao - bo;
            return String(a && a.source_unit_id || '').localeCompare(String(b && b.source_unit_id || ''));
        });
    }

    function orderedNodes(nodes) {
        return [...(nodes || [])].sort((a, b) => {
            const ao = Number(a && a.order);
            const bo = Number(b && b.order);
            if (ao !== bo) return ao - bo;
            return String(a && a.node_id || '').localeCompare(String(b && b.node_id || ''));
        });
    }

    function mergeNodes(existing, incoming) {
        const byId = new Map();
        for (const node of existing || []) byId.set(node.node_id, node);
        for (const node of incoming || []) byId.set(node.node_id, node);
        return orderedNodes([...byId.values()]);
    }

    function findNodeById(nodes, nodeId) {
        return (nodes || []).find((node) => node.node_id === nodeId) || null;
    }

    function isReflowableSourceUnit(unit) {
        return Boolean(unit && REFLOWABLE_KINDS.has(unit.kind));
    }

    function physicalPageSourceUnits(units) {
        return orderedSourceUnits(units).filter((unit) => unit.kind === 'physical_page');
    }

    function nodeTag(node) {
        if (!node || !node.node_type) return 'div';
        if (node.node_type === 'heading') {
            const level = Math.max(1, Math.min(6, Number(node.heading_level || 2)));
            return `h${level}`;
        }
        if (node.node_type === 'paragraph') return 'p';
        if (node.node_type === 'list') return 'ul';
        if (node.node_type === 'list_item') return 'li';
        if (node.node_type === 'caption') return 'figcaption';
        if (node.node_type === 'formula' || node.node_type === 'code') return 'pre';
        if (node.node_type === 'header') return 'header';
        if (node.node_type === 'footer') return 'footer';
        if (node.node_type === 'quote') return 'blockquote';
        return 'div';
    }

    function toPlainText(nodes) {
        const lines = [];
        for (const node of orderedNodes(nodes)) {
            if (TEXTUAL_TYPES.has(node.node_type) && typeof node.text === 'string' && node.text.trim()) {
                lines.push(node.text.trim());
            }
        }
        return lines.join('\n');
    }

    function stableAnchorValue(anchor) {
        if (!anchor || typeof anchor !== 'object') return '';
        const kind = String(anchor.kind || '');
        if (kind === 'spatial') return `${kind}:${(anchor.normalized_bbox || []).join(',')}`;
        if (kind === 'text_span') return `${kind}:${anchor.start}:${anchor.end}`;
        if (kind === 'temporal') return `${kind}:${anchor.start_ms}:${anchor.end_ms}`;
        if (kind === 'dom') return `${kind}:${anchor.path || ''}:${anchor.text_start ?? ''}:${anchor.text_end ?? ''}`;
        return `${kind}:${JSON.stringify(anchor)}`;
    }

    function locationKey(location) {
        if (!location) return '';
        return [
            location.contract_version || '',
            location.document_ref || '',
            location.candidate_id || '',
            location.candidate_schema_id || '',
            location.candidate_schema_version ?? '',
            location.node_id || '',
            location.source_unit_id || '',
            stableAnchorValue(location.source_anchor),
        ].join('|');
    }

    function warningCodes(value) {
        return [...new Set(((value && value.warnings) || []).map((warning) => warning.code).filter(Boolean))];
    }

    return {
        REFLOWABLE_KINDS,
        TEXTUAL_TYPES,
        findNodeById,
        isReflowableSourceUnit,
        locationKey,
        mergeNodes,
        nodeTag,
        orderedNodes,
        orderedSourceUnits,
        physicalPageSourceUnits,
        stableAnchorValue,
        toPlainText,
        warningCodes,
    };
});
