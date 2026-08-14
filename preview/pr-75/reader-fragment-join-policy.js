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

    function normalizedFragmentGroup(value) {
        const text = String(value || '').trim();
        return text || null;
    }

    function fragmentGroup(element) {
        const explicit = normalizedFragmentGroup(
            element?.presentation_canonical_node_id
            || element?.canonical_node_id
            || element?.fragment_of_node_id,
        );
        if (explicit) return explicit;
        const nodeId = String(element?.identity?.node_id || '').trim();
        const match = nodeId.match(/^(.*):page-fragment:\d+$/u);
        return match?.[1] || null;
    }

    function textSpanFromIdentity(identity) {
        const anchor = identity?.source_anchor;
        if (String(anchor?.kind || '').trim().toLowerCase() !== 'text_span') return null;
        const start = Number(anchor?.start);
        const end = Number(anchor?.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
        return { start, end };
    }

    function terminalTextSpan(element) {
        const spans = Array.isArray(element?.source_spans) ? element.source_spans : [];
        for (let index = spans.length - 1; index >= 0; index -= 1) {
            const span = textSpanFromIdentity(spans[index]);
            if (span) return span;
        }
        return textSpanFromIdentity(element?.identity);
    }

    function initialTextSpan(element) {
        const spans = Array.isArray(element?.source_spans) ? element.source_spans : [];
        for (const identity of spans) {
            const span = textSpanFromIdentity(identity);
            if (span) return span;
        }
        return textSpanFromIdentity(element?.identity);
    }

    function hasExplicitFragmentContinuity(previous, current) {
        const before = fragmentGroup(previous);
        const after = fragmentGroup(current);
        return Boolean(before && after && before === after);
    }

    function hasContiguousTextSpan(previous, current) {
        const before = terminalTextSpan(previous);
        const after = initialTextSpan(current);
        return Boolean(before && after && after.start === before.end);
    }

    function shouldJoinFragments(previous, current) {
        return Boolean(
            previous
            && previous.kind === 'text'
            && current?.kind === 'text'
            && JOINABLE_TYPES.has(previous.node_type)
            && JOINABLE_TYPES.has(current.node_type)
            && sameSource(previous, current)
            && (hasExplicitFragmentContinuity(previous, current) || hasContiguousTextSpan(previous, current))
        );
    }

    function joinReadingElements(elements) {
        const output = [];
        for (const element of elements || []) {
            const previous = output[output.length - 1];
            const joinable = shouldJoinFragments(previous, element);
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

    return {
        CJK_OR_CLOSING,
        CJK_OR_OPENING,
        JOINABLE_TYPES,
        fragmentGroup,
        hasContiguousTextSpan,
        hasExplicitFragmentContinuity,
        initialTextSpan,
        install,
        joinReadingElements,
        sameSource,
        separatorFor,
        shouldJoinFragments,
        terminalTextSpan,
        textSpanFromIdentity,
    };
});
