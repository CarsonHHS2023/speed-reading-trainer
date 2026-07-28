(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderTocRecoveryPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const TOC_HEADING = /^\s*目录\s*$/u;
    const ENTRY_END = /(?:\.{2,}|…{2,}|·{2,})\s*[0-9０-９]{1,4}/gu;

    function splitRecoveredToc(text) {
        const source = String(text || '').replace(/\r\n?/gu, '\n').trim();
        if (!source) return [];
        const explicit = source.split(/\n+/u).map((value) => value.trim()).filter(Boolean);
        if (explicit.length > 1) return explicit;

        const entries = [];
        let cursor = 0;
        let match;
        ENTRY_END.lastIndex = 0;
        while ((match = ENTRY_END.exec(source)) !== null) {
            const entry = source.slice(cursor, ENTRY_END.lastIndex).trim();
            if (entry) entries.push(entry);
            cursor = ENTRY_END.lastIndex;
        }
        const tail = source.slice(cursor).trim();
        if (tail) entries.push(tail);
        return entries;
    }

    function recoverElements(elements) {
        const output = [];
        let tocHeadingSeen = false;
        for (const element of elements || []) {
            const text = String(element?.text || '').trim();
            if (TOC_HEADING.test(text)) {
                if (tocHeadingSeen) continue;
                tocHeadingSeen = true;
                output.push({ ...element, node_type: 'heading', heading_level: element.heading_level || 1, text: '目录' });
                continue;
            }

            const entries = splitRecoveredToc(text);
            if (entries.length < 2) {
                output.push(element);
                continue;
            }

            entries.forEach((entry, index) => {
                output.push({
                    ...element,
                    element_id: `${element.element_id}:toc:${index}`,
                    node_type: 'list_item',
                    heading_level: null,
                    text: entry,
                    identity: element.identity ? { ...element.identity, node_id: `${element.identity.node_id}:toc:${index}` } : element.identity,
                });
            });
        }
        return output;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const adapter = rootObject?.SpeedReadingAdapter;
        if (!adapter || adapter.__tocRecoveryPolicyInstalled) return false;
        const original = adapter.buildReadingElements;
        if (typeof original !== 'function') return false;
        adapter.buildReadingElements = function buildRecoveredTocElements(documentView, nodes) {
            return recoverElements(original.call(this, documentView, nodes));
        };
        adapter.__tocRecoveryPolicyInstalled = true;
        adapter.recoverTocElements = recoverElements;
        return true;
    }

    return { ENTRY_END, TOC_HEADING, install, recoverElements, splitRecoveredToc };
});