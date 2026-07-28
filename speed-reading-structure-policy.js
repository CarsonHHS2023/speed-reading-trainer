(function (root, factory) {
    const api = factory(root && root.SpeedReadingAdapter);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.SpeedReadingStructurePolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Adapter) {
    'use strict';

    const FURNITURE_TYPES = new Set(['number', 'header', 'header_image', 'footer', 'footer_image', 'aside_text', 'footnote']);
    const TOC_TYPES = new Set(['toc', 'toc_item', 'list', 'list_item']);

    function normalizeType(value) {
        return String(value || '').trim().toLowerCase().replace(/[\s-]+/gu, '_');
    }

    function splitStructuredNodes(nodes) {
        const output = [];
        for (const node of nodes || []) {
            const rawType = normalizeType(node?.node_type);
            const rawText = typeof node?.text === 'string' ? node.text.replace(/\r\n?/gu, '\n') : '';
            const lines = TOC_TYPES.has(rawType)
                ? rawText.split(/\n+/u).map((line) => line.trim()).filter(Boolean)
                : [];
            if (lines.length <= 1) {
                output.push({ ...node, raw_node_type: rawType || null, node_type: TOC_TYPES.has(rawType) ? 'list_item' : node?.node_type });
                continue;
            }
            lines.forEach((line, index) => {
                output.push({
                    ...node,
                    node_id: `${node.node_id}:toc:${index}`,
                    node_type: 'list_item',
                    raw_node_type: rawType,
                    text: line,
                    order: Number(node.order || 0) + index / 1000,
                    location: node.location ? { ...node.location, node_id: `${node.node_id}:toc:${index}` } : node.location,
                });
            });
        }
        return output;
    }

    function diagnoseNodes(nodes) {
        const typeCounts = {};
        const excluded = [];
        const suspiciousNumericText = [];
        for (const node of nodes || []) {
            const type = normalizeType(node?.raw_node_type || node?.node_type || 'unknown') || 'unknown';
            typeCounts[type] = (typeCounts[type] || 0) + 1;
            if (FURNITURE_TYPES.has(type)) excluded.push({ node_id: node?.node_id || null, node_type: type, text: node?.text || '' });
            if ((type === 'paragraph' || type === 'unknown') && /^\s*[0-9０-９]+\s*$/u.test(String(node?.text || ''))) {
                suspiciousNumericText.push({ node_id: node?.node_id || null, node_type: type, text: node?.text || '' });
            }
        }
        return { type_counts: typeCounts, excluded_furniture: excluded, suspicious_numeric_text: suspiciousNumericText };
    }

    function install(rootObject = root) {
        const adapter = rootObject?.SpeedReadingAdapter || Adapter;
        if (!adapter || adapter.__structurePolicyInstalled) return false;
        const originalBuildReadingElements = adapter.buildReadingElements;
        const originalBuildPlaybackFrames = adapter.buildPlaybackFrames;
        if (typeof originalBuildReadingElements !== 'function' || typeof originalBuildPlaybackFrames !== 'function') return false;

        adapter.buildReadingElements = function buildPolicyReadingElements(documentView, nodes) {
            const prepared = splitStructuredNodes(nodes);
            const elements = originalBuildReadingElements(documentView, prepared);
            return elements.map((element) => {
                const source = prepared.find((node) => String(node.node_id) === String(element.identity?.node_id));
                return { ...element, raw_node_type: source?.raw_node_type || normalizeType(source?.node_type) || null };
            });
        };

        adapter.buildPlaybackFrames = function buildPolicyPlaybackFrames(documentView, nodes, options) {
            const prepared = splitStructuredNodes(nodes);
            const result = originalBuildPlaybackFrames(documentView, prepared, options);
            return { ...result, diagnostics: diagnoseNodes(prepared) };
        };

        adapter.__structurePolicyInstalled = true;
        adapter.diagnoseNodes = diagnoseNodes;
        adapter.splitStructuredNodes = splitStructuredNodes;
        return true;
    }

    if (root?.SpeedReadingAdapter) install(root);
    return { FURNITURE_TYPES, TOC_TYPES, diagnoseNodes, install, normalizeType, splitStructuredNodes };
});
