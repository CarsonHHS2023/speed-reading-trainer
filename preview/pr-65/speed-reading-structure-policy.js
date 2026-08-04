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

    function firstNormalized(values) {
        for (const value of values) {
            const normalized = normalizeType(value);
            if (normalized) return normalized;
        }
        return '';
    }

    function providerTypeForNode(node) {
        return firstNormalized([
            node?.metadata?.provider_block_label,
            node?.metadata?.block_label,
            node?.metadata?.source_label,
            node?.block_label,
            node?.source_label,
            node?.paddle_label,
            node?.raw_node_type,
            node?.label,
        ]);
    }

    function semanticTypeForNode(node) {
        return normalizeType(node?.node_type);
    }

    function canonicalType(rawType) {
        const normalized = normalizeType(rawType);
        return TYPE_ALIASES[normalized] || normalized || 'unknown';
    }

    function resolvedTypeForNode(node) {
        const providerType = providerTypeForNode(node);
        const providerCanonical = canonicalType(providerType);
        const semanticType = semanticTypeForNode(node);
        const semanticCanonical = canonicalType(semanticType);

        if (FURNITURE_TYPES.has(providerType) || FURNITURE_TYPES.has(providerCanonical)) {
            return { rawType: providerType, type: providerCanonical, providerType, semanticType };
        }
        if (semanticType && semanticType !== 'unknown') {
            return { rawType: providerType || semanticType, type: semanticCanonical, providerType, semanticType };
        }
        return {
            rawType: providerType || semanticType || 'unknown',
            type: providerCanonical || semanticCanonical || 'unknown',
            providerType,
            semanticType,
        };
    }

    function rawTypeForNode(node) {
        return resolvedTypeForNode(node).rawType;
    }

    function normalizedHeadingLevel(node) {
        const value = node?.heading_level;
        return Number.isInteger(value) && value >= 1 && value <= 6 ? value : null;
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
            const resolved = resolvedTypeForNode(node);
            const rawType = resolved.rawType;
            const type = resolved.type;
            const text = typeof node?.text === 'string' ? node.text.replace(/\r\n?/gu, '\n').trim() : '';
            if (FURNITURE_TYPES.has(rawType) || FURNITURE_TYPES.has(type)) continue;
            if (appendPunctuationNode(output, node, text)) continue;

            const tocLike = TOC_TYPES.has(resolved.providerType) || TOC_TYPES.has(resolved.semanticType) || TOC_TYPES.has(type);
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
            const resolved = resolvedTypeForNode(node);
            const rawType = resolved.rawType;
            const type = resolved.type;
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
            const prepared = prepareStructuredNodes(nodes);
            const preparedById = new Map(prepared.map((node) => [String(node.node_id), node]));
            return originalBuildReadingElements(documentView, prepared).map((element) => {
                const source = preparedById.get(String(element?.identity?.node_id));
                return {
                    ...element,
                    heading_level: normalizedHeadingLevel(source),
                    raw_node_type: source?.raw_node_type || null,
                };
            });
        };

        adapter.buildPlaybackFrames = function buildPolicyPlaybackFrames(documentView, nodes, options) {
            const prepared = prepareStructuredNodes(nodes);
            const result = originalBuildPlaybackFrames(documentView, prepared, options);
            return { ...result, diagnostics: diagnoseNodes(nodes), prepared_node_count: prepared.length };
        };

        adapter.__structurePolicyInstalled = true;
        adapter.canonicalType = canonicalType;
        adapter.diagnoseNodes = diagnoseNodes;
        adapter.normalizedHeadingLevel = normalizedHeadingLevel;
        adapter.prepareStructuredNodes = prepareStructuredNodes;
        adapter.providerTypeForNode = providerTypeForNode;
        adapter.rawTypeForNode = rawTypeForNode;
        adapter.resolvedTypeForNode = resolvedTypeForNode;
        adapter.semanticTypeForNode = semanticTypeForNode;
        adapter.splitStructuredNodes = prepareStructuredNodes;
        adapter.splitTocText = splitTocText;
        return true;
    }

    if (rootObject?.SpeedReadingAdapter) install(rootObject);
    return {
        FURNITURE_TYPES, TOC_TYPES, TYPE_ALIASES, canonicalType, diagnoseNodes, install,
        normalizeType, normalizedHeadingLevel, prepareStructuredNodes, providerTypeForNode, rawTypeForNode,
        resolvedTypeForNode, semanticTypeForNode, splitStructuredNodes: prepareStructuredNodes, splitTocText,
    };
});
