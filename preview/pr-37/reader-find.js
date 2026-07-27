(function (root, factory) {
    const api = factory(root && root.ReaderModelV2);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderFindV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Model) {
    'use strict';

    const DEFAULT_MAX_RESULTS = 200;

    function requireModel() {
        if (!Model && typeof require === 'function') Model = require('./reader-model.js');
        if (!Model) throw new Error('ReaderModelV2 is required');
        return Model;
    }

    function normalizeQuery(query) {
        return String(query == null ? '' : query).trim();
    }

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function resultIdentity(documentView, node, start, end) {
        const location = node?.location || {};
        return {
            contract_version: String(documentView?.contract_version || '2'),
            document_ref: String(documentView?.document_ref || ''),
            candidate_id: String(documentView?.candidate_id || ''),
            candidate_schema_id: String(documentView?.candidate_schema_id || ''),
            candidate_schema_version: Number(documentView?.candidate_schema_version || 2),
            node_id: String(node?.node_id || ''),
            source_unit_id: location.source_unit_id || node?.source_unit_ids?.[0] || null,
            source_anchor: location.source_anchor || node?.source_anchors?.[0] || null,
            match_start: start,
            match_end: end,
        };
    }

    function findInNodes(documentView, nodes, query, options = {}) {
        const model = requireModel();
        const normalized = normalizeQuery(query);
        const maxResults = Math.max(1, Number(options.maxResults) || DEFAULT_MAX_RESULTS);
        if (!normalized) return { query: '', results: [], truncated: false };

        const pattern = new RegExp(escapeRegExp(normalized), 'giu');
        const results = [];
        let truncated = false;

        outer: for (const node of model.orderedNodes(nodes)) {
            if (typeof node?.text !== 'string' || !node.text) continue;
            pattern.lastIndex = 0;
            let match;
            let ordinal = 0;
            while ((match = pattern.exec(node.text)) !== null) {
                const start = match.index;
                const end = start + match[0].length;
                if (results.length >= maxResults) {
                    truncated = true;
                    break outer;
                }
                results.push({
                    result_id: `reader-find:${documentView?.candidate_id || ''}:${node.node_id}:${String(ordinal).padStart(4, '0')}:${start}-${end}`,
                    node_id: node.node_id,
                    node_order: Number(node.order),
                    match_ordinal: ordinal,
                    match_start: start,
                    match_end: end,
                    matched_text: node.text.slice(start, end),
                    identity: resultIdentity(documentView, node, start, end),
                });
                ordinal += 1;
                if (match[0].length === 0) pattern.lastIndex += 1;
            }
        }

        return { query: normalized, results, truncated };
    }

    function sameCandidate(result, documentView) {
        return Boolean(
            result?.identity
            && documentView
            && String(result.identity.document_ref) === String(documentView.document_ref)
            && String(result.identity.candidate_id) === String(documentView.candidate_id)
            && Number(result.identity.candidate_schema_version) === Number(documentView.candidate_schema_version),
        );
    }

    return {
        DEFAULT_MAX_RESULTS,
        findInNodes,
        normalizeQuery,
        sameCandidate,
    };
});
