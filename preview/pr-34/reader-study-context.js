(function (root, factory) {
    const api = factory(
        root && root.ReaderModelV2,
        root && root.ReaderAnnotationsV2,
        root && root.ReaderHighlightsV2,
    );
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderStudyContextV1 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Model, Annotations, Highlights) {
    'use strict';

    const CONTRACT = 'reader-study-context';
    const VERSION = 1;
    const DEFAULT_MAX_ITEMS = 100;
    const DEFAULT_EXCERPT_LENGTH = 280;

    function resolveDeps() {
        if (typeof require === 'function') {
            Model = Model || require('./reader-model.js');
            Annotations = Annotations || require('./reader-annotations.js');
            Highlights = Highlights || require('./reader-highlights.js');
        }
        if (!Model || !Annotations || !Highlights) throw new Error('Reader v2 StudyContext dependencies are required');
        return { Model, Annotations, Highlights };
    }

    function positiveInt(value, fallback) {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
    }

    function boundedText(value, maxLength) {
        const text = String(value || '').trim();
        if (!text) return '';
        const limit = positiveInt(maxLength, DEFAULT_EXCERPT_LENGTH);
        return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
    }

    function cloneAnchor(anchor) {
        if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) return null;
        try { return JSON.parse(JSON.stringify(anchor)); } catch (_) { return null; }
    }

    function nodeOrderMap(nodes) {
        const deps = resolveDeps();
        const ordered = deps.Model.orderedNodes(nodes || []);
        return new Map(ordered.map((node, index) => [String(node.node_id), Number.isFinite(Number(node.order)) ? Number(node.order) : index]));
    }

    function baseIdentity(record) {
        return {
            candidate_id: record.candidate_id,
            node_id: record.node_id,
            source_unit_id: record.source_unit_id || null,
            source_anchor: cloneAnchor(record.source_anchor),
        };
    }

    function buildStudyContext(documentView, nodes, annotationRecords, highlightRecords, options = {}) {
        const deps = resolveDeps();
        if (!documentView || String(documentView.contract_version || '') !== '2' || !documentView.candidate_id) return null;

        const maxItems = positiveInt(options.maxItems, DEFAULT_MAX_ITEMS);
        const excerptLength = positiveInt(options.excerptLength, DEFAULT_EXCERPT_LENGTH);
        const orderedNodes = deps.Model.orderedNodes(nodes || []);
        const byId = new Map(orderedNodes.map((node) => [String(node.node_id), node]));
        const orderById = nodeOrderMap(orderedNodes);
        const current = [];
        let staleCount = 0;
        let invalidCount = 0;

        for (const raw of annotationRecords || []) {
            const record = deps.Annotations.normalizeRecord(raw);
            if (!record) { invalidCount += 1; continue; }
            if (!deps.Annotations.sameCandidate(record, documentView)) { staleCount += 1; continue; }
            const node = byId.get(record.node_id);
            if (!node) { invalidCount += 1; continue; }
            const nodeText = String(node.text || '');
            current.push({
                kind: record.kind,
                item_id: record.annotation_id,
                ...baseIdentity(record),
                node_order: orderById.get(record.node_id) ?? Number.MAX_SAFE_INTEGER,
                note_text: record.kind === 'note' ? record.note_text : null,
                excerpt: boundedText(nodeText, excerptLength),
                created_at: record.created_at,
            });
        }

        for (const raw of highlightRecords || []) {
            const record = deps.Highlights.normalizeRecord(raw);
            if (!record) { invalidCount += 1; continue; }
            if (!deps.Highlights.sameCandidate(record, documentView)) { staleCount += 1; continue; }
            const node = byId.get(record.node_id);
            if (!node) { invalidCount += 1; continue; }
            const nodeText = String(node.text || '');
            if (!deps.Highlights.validForText(record, nodeText.length)) { invalidCount += 1; continue; }
            current.push({
                kind: 'highlight',
                item_id: record.highlight_id,
                ...baseIdentity(record),
                node_order: orderById.get(record.node_id) ?? Number.MAX_SAFE_INTEGER,
                text_start: record.text_start,
                text_end: record.text_end,
                highlight_style: record.style,
                excerpt: boundedText(nodeText.slice(record.text_start, record.text_end), excerptLength),
                created_at: record.created_at,
            });
        }

        current.sort((a, b) => a.node_order - b.node_order
            || Number(a.created_at || 0) - Number(b.created_at || 0)
            || String(a.item_id).localeCompare(String(b.item_id)));

        const truncated = current.length > maxItems;
        const items = current.slice(0, maxItems).map(({ node_order, created_at, ...item }) => item);
        return {
            contract: CONTRACT,
            version: VERSION,
            document_ref: String(documentView.document_ref || ''),
            candidate_id: String(documentView.candidate_id || ''),
            reader_contract_version: String(documentView.contract_version || ''),
            candidate_schema_id: String(documentView.candidate_schema_id || ''),
            candidate_schema_version: Number(documentView.candidate_schema_version),
            items,
            stats: {
                included: items.length,
                stale_excluded: staleCount,
                invalid_excluded: invalidCount,
                truncated,
                max_items: maxItems,
            },
        };
    }

    function targetNodeIds(documentView, annotationRecords, highlightRecords, options = {}) {
        const deps = resolveDeps();
        const maxItems = positiveInt(options.maxItems, DEFAULT_MAX_ITEMS);
        const rows = [];
        for (const raw of annotationRecords || []) {
            const record = deps.Annotations.normalizeRecord(raw);
            if (record && deps.Annotations.sameCandidate(record, documentView)) rows.push(record);
        }
        for (const raw of highlightRecords || []) {
            const record = deps.Highlights.normalizeRecord(raw);
            if (record && deps.Highlights.sameCandidate(record, documentView)) rows.push(record);
        }
        rows.sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0)
            || String(a.annotation_id || a.highlight_id || '').localeCompare(String(b.annotation_id || b.highlight_id || '')));
        return [...new Set(rows.slice(0, maxItems).map((record) => record.node_id).filter(Boolean))];
    }

    return {
        CONTRACT,
        DEFAULT_EXCERPT_LENGTH,
        DEFAULT_MAX_ITEMS,
        VERSION,
        boundedText,
        buildStudyContext,
        targetNodeIds,
    };
});