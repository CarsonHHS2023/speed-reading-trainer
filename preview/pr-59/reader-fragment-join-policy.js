(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderFragmentJoinPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const JOINABLE_TYPES = new Set(['paragraph', 'unknown']);
    const CJK_OR_CLOSING = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。；：！？、…—”’）】》〉」』〕］｝]$/u;
    const CJK_OR_OPENING = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}“‘（【《〈「『〔［｛]/u;
    const PARAGRAPH_END = /[。！？!?；;：:]\s*$/u;

    function cleanFragmentText(value) {
        return String(value || '').replace(/^\s+/u, '').replace(/\s+$/u, '');
    }

    function separatorFor(previousText, currentText) {
        const before = cleanFragmentText(previousText);
        const after = cleanFragmentText(currentText);
        if (!before || !after) return '';
        if (CJK_OR_CLOSING.test(before) && CJK_OR_OPENING.test(after)) return '';
        return ' ';
    }

    function sameSource(previous, current) {
        return Boolean(
            previous?.identity?.source_unit_id
            && previous.identity.source_unit_id === current?.identity?.source_unit_id
        );
    }

    function shouldJoin(previous, current) {
        if (!previous || previous.kind !== 'text' || current?.kind !== 'text') return false;
        if (!JOINABLE_TYPES.has(previous.node_type) || !JOINABLE_TYPES.has(current.node_type)) return false;
        if (!sameSource(previous, current)) return false;
        if (PARAGRAPH_END.test(cleanFragmentText(previous.text))) return false;
        return true;
    }

    function joinReadingElements(elements) {
        const output = [];
        for (const originalElement of elements || []) {
            const element = {
                ...originalElement,
                text: cleanFragmentText(originalElement?.text),
            };
            const previous = output[output.length - 1];
            if (!shouldJoin(previous, element)) {
                output.push(element);
                continue;
            }
            const separator = separatorFor(previous.text, element.text);
            output[output.length - 1] = {
                ...previous,
                text: `${cleanFragmentText(previous.text)}${separator}${cleanFragmentText(element.text)}`,
                reading_units: Number(previous.reading_units || 0) + Number(element.reading_units || 0),
                source_spans: [
                    ...(Array.isArray(previous.source_spans) ? previous.source_spans : [previous.identity].filter(Boolean)),
                    ...(Array.isArray(element.source_spans) ? element.source_spans : [element.identity].filter(Boolean)),
                ],
            };
        }
        return output;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const adapter = rootObject?.SpeedReadingAdapter;
        if (!adapter || adapter.__fragmentJoinPolicyInstalled) return false;
        const original = adapter.buildReadingElements;
        if (typeof original !== 'function') return false;
        adapter.buildReadingElements = function buildJoinedReadingElements(documentView, nodes) {
            return joinReadingElements(original.call(this, documentView, nodes));
        };
        adapter.__fragmentJoinPolicyInstalled = true;
        adapter.joinReadingElements = joinReadingElements;
        return true;
    }

    return {
        CJK_OR_CLOSING,
        CJK_OR_OPENING,
        JOINABLE_TYPES,
        PARAGRAPH_END,
        cleanFragmentText,
        install,
        joinReadingElements,
        separatorFor,
        shouldJoin,
    };
});