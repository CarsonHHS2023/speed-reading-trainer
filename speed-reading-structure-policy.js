(function (root, factory) {
    const api = factory(root && root.SpeedReadingAdapter, root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.SpeedReadingStructurePolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Adapter, rootObject) {
    'use strict';

    const FURNITURE_TYPES = new Set([
        'number', 'page_number', 'header', 'header_image', 'footer', 'footer_image', 'aside_text', 'footnote', 'vision_footnote',
    ]);
    const TOC_TYPES = new Set(['toc', 'toc_item', 'content', 'table_of_contents', 'list', 'list_item']);
    const TYPE_ALIASES = Object.freeze({
        doc_title: 'title', document_title: 'title',
        paragraph_title: 'heading', figure_title: 'caption',
        text: 'paragraph', abstract: 'paragraph',
        content: 'list_item', toc: 'list_item', toc_item: 'list_item', table_of_contents: 'list_item',
        algorithm: 'code',
        figure_caption: 'caption', table_caption: 'caption',
        image: 'figure', chart: 'figure',
        display_formula: 'formula', inline_formula: 'formula',
        reference_content: 'reference',
        vision_footnote: 'footnote', page_number: 'number',
    });
    const PUNCTUATION_ONLY = /^[\s,.;:!?%。，；：！？％、…—”’）】》〉」』〕］｝]+$/u;

    function normalizeType(value) {
        return String(value || '').trim().toLowerCase().replace(/[\s-]+/gu, '_');
    }

    function rawTypeForNode(node) {
        const candidates = [
            node?.metadata?.provider_block_label,
            node?.metadata?.block_label,
            node?.metadata?.source_label,
            node?.block_label,
            node?.source_label,
            node?.paddle_label,
            node?.raw_node_type,
            node?.label,
            node?.node_type,
        ];
        for (const value of candidates) {
            const normalized = normalizeType(value);
            if (normalized) return normalized;
        }
        return 'unknown';
    }

    function canonicalType(rawType) {
        const normalized = normalizeType(rawType);
        return TYPE_ALIASES[normalized] || normalized || 'unknown';
    }

    function splitTocText(text) {
        const normalized = String(text || '').replace(/\r\n?/gu, '\n').trim();
        if (!normalized) return [];
        const explicit = normalized.split(/\n+/u).map((line) => line.trim()).filter(Boolean);
        if (explicit.length > 1) return explicit;

        const entries = [];
        const terminatorPattern = /(?:\.{2,}|…{2,}|·{2,})\s*[0-9０-９]{1,4}/gu;
        let match;
        let cursor = 0;
        while ((match = terminatorPattern.exec(normalized)) !== null) {
            const entry = normalized.slice(cursor, terminatorPattern.lastIndex).trim();
            if (entry) entries.push(entry);
            cursor = terminatorPattern.lastIndex;
        }
        const tail = normalized.slice(cursor).trim();
        if (tail) entries.push(tail);
        return entries.length > 1 ? entries : [normalized];
    }

    function appendPunctuationNode(output, node, text) {
        if (!PUNCTUATION_ONLY.test(text) || !output.length) return false;
        const previous = output[output.length - 1];
        const previousType = canonicalType(previous?.node_type);
        if (!['paragraph', 'unknown', 'caption', 'reference', 'list_item'].includes(previousType)) return false;
        output[output.length - 1] = {
            ...previous,
            text: `${String(previous.text || '').replace(/\s+$/u, '')}${text.trim()}`,
            source_spans: [...(Array.isArray(previous.source_spans) ? previous.source_spans : []), ...(Array.isArray(node?.source_spans) ? node.source_spans : [])],
        };
        return true;
    }

    function prepareStructuredNodes(nodes) {
        const output = [];
        for (const node of nodes || []) {
            const rawType = rawTypeForNode(node);
            const type = canonicalType(rawType);
            const text = typeof node?.text === 'string' ? node.text.replace(/\r\n?/gu, '\n').trim() : '';
            if (FURNITURE_TYPES.has(rawType) || FURNITURE_TYPES.has(type)) continue;
            if (appendPunctuationNode(output, node, text)) continue;

            const tocLike = TOC_TYPES.has(rawType) || TOC_TYPES.has(type);
            const entries = tocLike ? splitTocText(text) : [text];
            if (entries.length <= 1) {
                output.push({ ...node, raw_node_type: rawType, node_type: tocLike ? 'list_item' : type, text });
                continue;
            }
            entries.forEach((entry, index) => {
                const syntheticId = `${node.node_id}:toc:${index}`;
                output.push({
                    ...node,
                    node_id: syntheticId,
                    node_type: 'list_item',
                    raw_node_type: rawType,
                    text: entry,
                    order: Number(node.order || 0) + index / 1000,
                    location: node.location ? { ...node.location, node_id: syntheticId } : node.location,
                });
            });
        }
        return output;
    }

    function diagnoseNodes(nodes) {
        const typeCounts = {};
        const excluded = [];
        for (const node of nodes || []) {
            const rawType = rawTypeForNode(node);
            const type = canonicalType(rawType);
            typeCounts[rawType] = (typeCounts[rawType] || 0) + 1;
            if (FURNITURE_TYPES.has(rawType) || FURNITURE_TYPES.has(type)) {
                excluded.push({ node_id: node?.node_id || null, raw_node_type: rawType, node_type: type, text: node?.text || '' });
            }
        }
        return { type_counts: typeCounts, excluded_furniture: excluded };
    }

    function install(targetRoot = rootObject) {
        const adapter = targetRoot?.SpeedReadingAdapter || Adapter;
        if (!adapter || adapter.__structurePolicyInstalled) return false;
        const originalBuildReadingElements = adapter.buildReadingElements;
        const originalBuildPlaybackFrames = adapter.buildPlaybackFrames;
        if (typeof originalBuildReadingElements !== 'function' || typeof originalBuildPlaybackFrames !== 'function') return false;

        adapter.buildReadingElements = function buildPolicyReadingElements(documentView, nodes) {
            return originalBuildReadingElements(documentView, prepareStructuredNodes(nodes));
        };

        adapter.buildPlaybackFrames = function buildPolicyPlaybackFrames(documentView, nodes, options) {
            const prepared = prepareStructuredNodes(nodes);
            const result = originalBuildPlaybackFrames(documentView, prepared, options);
            return { ...result, diagnostics: diagnoseNodes(nodes), prepared_node_count: prepared.length };
        };

        adapter.__structurePolicyInstalled = true;
        adapter.canonicalType = canonicalType;
        adapter.diagnoseNodes = diagnoseNodes;
        adapter.prepareStructuredNodes = prepareStructuredNodes;
        adapter.rawTypeForNode = rawTypeForNode;
        adapter.splitStructuredNodes = prepareStructuredNodes;
        adapter.splitTocText = splitTocText;
        return true;
    }

    if (rootObject?.SpeedReadingAdapter) install(rootObject);
    return {
        FURNITURE_TYPES, TOC_TYPES, TYPE_ALIASES, canonicalType, diagnoseNodes, install,
        normalizeType, prepareStructuredNodes, rawTypeForNode, splitStructuredNodes: prepareStructuredNodes, splitTocText,
    };
});
