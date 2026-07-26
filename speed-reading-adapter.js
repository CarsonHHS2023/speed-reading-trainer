(function (root, factory) {
    const api = factory(root && root.ReaderModelV2);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.SpeedReadingAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Model) {
    'use strict';

    const MANUAL_NODE_TYPES = new Set(['figure', 'table', 'formula']);
    const TEXT_NODE_TYPES = new Set([
        'title', 'heading', 'paragraph', 'list', 'list_item', 'caption', 'header', 'footer',
        'footnote', 'quote', 'code', 'reference', 'unknown',
    ]);
    const DISPLAY_SCOPES = new Set(['block', 'line', 'page']);
    const MIN_FRAME_DURATION_MS = 1000 / 12;

    function requireModel() {
        if (!Model && typeof require === 'function') Model = require('./reader-model.js');
        if (!Model) throw new Error('ReaderModelV2 is required');
        return Model;
    }

    function isCjk(char) {
        return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char);
    }

    function tokenizeReadingText(text) {
        const input = String(text || '');
        const tokens = [];
        let i = 0;
        while (i < input.length) {
            const rest = input.slice(i);
            const english = rest.match(/^[A-Za-z]+(?:['’-][A-Za-z]+)*/u);
            if (english) {
                tokens.push({ kind: 'english_word', text: english[0], reading_units: 3, display_width: [...english[0]].length });
                i += english[0].length;
                continue;
            }
            const char = String.fromCodePoint(input.codePointAt(i));
            i += char.length;
            if (/\s/u.test(char)) {
                tokens.push({ kind: char.includes('\n') || char.includes('\r') ? 'newline' : 'space', text: char, reading_units: 0, display_width: 0 });
            } else if (isCjk(char)) {
                tokens.push({ kind: 'cjk', text: char, reading_units: 1, display_width: 1 });
            } else {
                tokens.push({ kind: 'punctuation', text: char, reading_units: 0, display_width: 1 });
            }
        }
        return tokens;
    }

    function countReadingUnits(text) {
        return tokenizeReadingText(text).reduce((sum, token) => sum + token.reading_units, 0);
    }

    function durationMs(readingUnits, speedPerMinute) {
        const speed = Number(speedPerMinute);
        if (!Number.isFinite(speed) || speed <= 0) throw new Error('speedPerMinute must be positive');
        const units = Math.max(0, Number(readingUnits) || 0);
        return Math.max(units * 60000 / speed, MIN_FRAME_DURATION_MS);
    }

    function identityForNode(documentView, node) {
        return {
            contract_version: String(documentView?.contract_version || '2'),
            document_ref: String(documentView?.document_ref || ''),
            candidate_id: String(documentView?.candidate_id || ''),
            candidate_schema_id: String(documentView?.candidate_schema_id || ''),
            candidate_schema_version: Number(documentView?.candidate_schema_version || 2),
            node_id: String(node?.node_id || ''),
            source_unit_id: node?.location?.source_unit_id || node?.source_unit_ids?.[0] || null,
            source_anchor: node?.location?.source_anchor || node?.source_anchors?.[0] || null,
        };
    }

    function buildReadingElements(documentView, nodes) {
        const model = requireModel();
        return model.orderedNodes(nodes).map((node) => {
            const manual = MANUAL_NODE_TYPES.has(node.node_type);
            const text = typeof node.text === 'string' ? node.text : '';
            return {
                element_id: `reading-element:${documentView.candidate_id}:${node.node_id}`,
                kind: manual ? 'manual' : 'text',
                node_type: node.node_type,
                text,
                asset_refs: Array.isArray(node.asset_refs) ? [...node.asset_refs] : [],
                reading_units: manual ? 0 : countReadingUnits(text),
                identity: identityForNode(documentView, node),
            };
        }).filter((element) => element.kind === 'manual' || TEXT_NODE_TYPES.has(element.node_type));
    }

    function appendToken(line, token, lineWidth) {
        if (token.kind === 'newline') return { accepted: false, forcedBreak: true };
        const projected = line.display_width + token.display_width;
        if (line.tokens.length && token.display_width > 0 && projected > lineWidth) return { accepted: false, forcedBreak: false };
        line.tokens.push(token);
        line.display_width = projected;
        line.reading_units += token.reading_units;
        return { accepted: true, forcedBreak: false };
    }

    function tokensToLines(tokens, lineWidth) {
        const width = Math.max(1, Number(lineWidth) || 35);
        const lines = [];
        let line = { tokens: [], display_width: 0, reading_units: 0 };
        const flush = () => {
            if (line.tokens.length) lines.push(line);
            line = { tokens: [], display_width: 0, reading_units: 0 };
        };
        for (const token of tokens) {
            const result = appendToken(line, token, width);
            if (result.accepted) continue;
            flush();
            if (!result.forcedBreak) {
                line.tokens.push(token);
                line.display_width = token.display_width;
                line.reading_units = token.reading_units;
            }
        }
        flush();
        return lines;
    }

    function lineText(line) {
        return line.tokens.map((token) => token.text).join('').trim();
    }

    function frameId(element, ordinal) {
        return `playback-frame:${element.identity.candidate_id}:${element.identity.node_id}:${String(ordinal).padStart(4, '0')}`;
    }

    function makeTimedFrame(element, ordinal, text, readingUnits, options) {
        return {
            frame_id: frameId(element, ordinal),
            kind: 'timed_text',
            node_type: element.node_type,
            text,
            reading_units: readingUnits,
            duration_ms: durationMs(readingUnits, options.speedPerMinute),
            identity: element.identity,
            frame_ordinal: ordinal,
        };
    }

    function framesForElement(element, options) {
        if (element.kind === 'manual') {
            return [{
                frame_id: frameId(element, 0),
                kind: 'manual',
                node_type: element.node_type,
                text: element.text,
                asset_refs: [...element.asset_refs],
                reading_units: 0,
                duration_ms: null,
                auto_advance: false,
                identity: element.identity,
                frame_ordinal: 0,
            }];
        }
        if (!element.text) return [];
        const tokens = tokenizeReadingText(element.text);
        const lines = tokensToLines(tokens, options.lineWidth);
        const scope = options.displayScope;
        if (scope === 'line') {
            return lines.map((line, index) => makeTimedFrame(element, index, lineText(line), line.reading_units, options));
        }
        const maxLines = Math.max(1, Number(options.maxLines) || 20);
        if (scope === 'page') {
            const frames = [];
            for (let i = 0; i < lines.length; i += maxLines) {
                const group = lines.slice(i, i + maxLines);
                frames.push(makeTimedFrame(
                    element,
                    frames.length,
                    group.map(lineText).join('\n'),
                    group.reduce((sum, line) => sum + line.reading_units, 0),
                    options,
                ));
            }
            return frames;
        }
        if (lines.length <= maxLines) return [makeTimedFrame(element, 0, element.text, element.reading_units, options)];
        const frames = [];
        for (let i = 0; i < lines.length; i += maxLines) {
            const group = lines.slice(i, i + maxLines);
            frames.push(makeTimedFrame(
                element,
                frames.length,
                group.map(lineText).join('\n'),
                group.reduce((sum, line) => sum + line.reading_units, 0),
                options,
            ));
        }
        return frames;
    }

    function buildPlaybackFrames(documentView, nodes, options = {}) {
        const displayScope = options.displayScope || 'block';
        if (!DISPLAY_SCOPES.has(displayScope)) throw new Error('displayScope must be block, line, or page');
        const normalizedOptions = {
            displayScope,
            lineWidth: Math.max(1, Number(options.lineWidth) || 35),
            maxLines: Math.max(1, Number(options.maxLines) || 20),
            speedPerMinute: Number(options.speedPerMinute) || 5000,
        };
        const elements = buildReadingElements(documentView, nodes);
        const frames = elements.flatMap((element) => framesForElement(element, normalizedOptions));
        return { elements, frames, options: normalizedOptions };
    }

    return {
        DISPLAY_SCOPES,
        MANUAL_NODE_TYPES,
        MIN_FRAME_DURATION_MS,
        buildPlaybackFrames,
        buildReadingElements,
        countReadingUnits,
        durationMs,
        tokenizeReadingText,
        tokensToLines,
    };
});