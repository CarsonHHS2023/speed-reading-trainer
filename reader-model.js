(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const TEXTUAL_TYPES = new Set([
        'heading', 'paragraph', 'list_item', 'caption', 'formula', 'header', 'footer', 'footnote', 'unknown',
    ]);

    function stateLabel(state) {
        return {
            ready: '完整',
            partial: '部分可用',
            degraded: '部分降级',
            unavailable: '不可用',
            no_usable_semantic_content: '没有可读内容',
        }[state] || String(state || '未知状态');
    }

    function stateMessage(state) {
        return {
            ready: '',
            partial: '部分内容尚未完整恢复，当前可用内容仍可阅读。',
            degraded: '部分内容已降级显示；不会用推测内容替代缺失内容。',
            unavailable: '当前 Reader 内容不可用。',
            no_usable_semantic_content: '当前文档没有可供 Reader 显示的语义内容。',
        }[state] || 'Reader 返回了未知内容状态。';
    }

    function processingMessage(state) {
        return {
            pending: '文档正在等待处理。',
            processing: '文档仍在处理中。',
            completed: '',
            failed: '文档处理失败。',
        }[state] || '';
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
        if (node.node_type === 'formula') return 'pre';
        if (node.node_type === 'header') return 'header';
        if (node.node_type === 'footer') return 'footer';
        return 'div';
    }

    function orderedPages(pages) {
        return [...(pages || [])].sort((a, b) => Number(a.page_order) - Number(b.page_order));
    }

    function orderedNodes(page) {
        return [...((page && page.nodes) || [])].sort((a, b) => Number(a.order) - Number(b.order));
    }

    function mergePages(existing, incoming) {
        const byId = new Map();
        for (const page of existing || []) byId.set(page.page_id, page);
        for (const page of incoming || []) byId.set(page.page_id, page);
        return orderedPages([...byId.values()]);
    }

    function findPageById(pages, pageId) {
        return (pages || []).find((page) => page.page_id === pageId) || null;
    }

    function findNodeById(pages, nodeId) {
        for (const page of pages || []) {
            const node = (page.nodes || []).find((item) => item.node_id === nodeId);
            if (node) return { page, node };
        }
        return null;
    }

    function toPlainText(pages) {
        const lines = [];
        for (const page of orderedPages(pages)) {
            for (const node of orderedNodes(page)) {
                if (TEXTUAL_TYPES.has(node.node_type) && typeof node.text === 'string' && node.text.trim()) {
                    lines.push(node.text.trim());
                }
            }
        }
        return lines.join('\n');
    }

    function warningCodes(value) {
        return [...new Set(((value && value.warnings) || []).map((warning) => warning.code).filter(Boolean))];
    }

    function recoverySummary(openResponse) {
        const messages = [];
        const processing = processingMessage(openResponse && openResponse.processing_state);
        const content = stateMessage(openResponse && openResponse.content_state);
        if (processing) messages.push(processing);
        if (content) messages.push(content);
        const codes = warningCodes(openResponse);
        if (codes.length) messages.push(`恢复提示：${codes.join('、')}`);
        return {
            state: (openResponse && openResponse.content_state) || 'unavailable',
            label: stateLabel(openResponse && openResponse.content_state),
            messages,
        };
    }

    function locationKey(location) {
        if (!location) return '';
        return [
            location.contract_version,
            location.document_ref,
            location.candidate_id,
            location.candidate_schema_id,
            location.candidate_schema_version,
            location.page_id || '',
            location.node_id || '',
            location.segment_index == null ? '' : location.segment_index,
        ].join('|');
    }

    return {
        TEXTUAL_TYPES,
        findNodeById,
        findPageById,
        locationKey,
        mergePages,
        nodeTag,
        orderedNodes,
        orderedPages,
        processingMessage,
        recoverySummary,
        stateLabel,
        stateMessage,
        toPlainText,
        warningCodes,
    };
});
