(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderFragmentJoinPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const JOINABLE_TYPES = new Set(['paragraph', 'unknown']);
    const CJK_OR_CLOSING = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}，。；：！？、…—”’）】》〉」』〕］｝]$/u;
    const CJK_OR_OPENING = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}“‘（【《〈「『〔［｛]/u;

    function separatorFor(previousText, currentText) {
        const before = String(previousText || '');
        const after = String(currentText || '');
        if (!before || !after) return '';
        if (/\s$/u.test(before) || /^\s/u.test(after)) return '';
        if (CJK_OR_CLOSING.test(before) && CJK_OR_OPENING.test(after)) return '';
        return ' ';
    }

    function sameSource(previous, current) {
        return Boolean(
            previous?.identity?.source_unit_id
            && previous.identity.source_unit_id === current?.identity?.source_unit_id
        );
    }

    function joinReadingElements(elements) {
        const output = [];
        for (const element of elements || []) {
            const previous = output[output.length - 1];
            const joinable = previous
                && previous.kind === 'text'
                && element?.kind === 'text'
                && JOINABLE_TYPES.has(previous.node_type)
                && JOINABLE_TYPES.has(element.node_type)
                && sameSource(previous, element);
            if (!joinable) {
                output.push(element);
                continue;
            }
            const separator = separatorFor(previous.text, element.text);
            output[output.length - 1] = {
                ...previous,
                text: `${previous.text || ''}${separator}${element.text || ''}`,
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

    return { CJK_OR_CLOSING, CJK_OR_OPENING, JOINABLE_TYPES, install, joinReadingElements, separatorFor };
});
