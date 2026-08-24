(function (root, factory) {
    const api = factory(root && root.ReaderModelV2);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.SpeedReadingAdapter = api;
        if (typeof root.setTimeout === 'function') {
            root.setTimeout(() => api.installPlaybackRenderer?.(root), 0);
        }
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Model) {
    'use strict';

    const MANUAL_NODE_TYPES = new Set(['figure', 'table', 'formula']);
    const EXCLUDED_PADDLE_NODE_TYPES = new Set([
        'number', 'header', 'header_image', 'footer', 'footer_image', 'aside_text', 'footnote',
    ]);
    const TEXT_NODE_TYPES = new Set([
        'title', 'heading', 'paragraph', 'list', 'list_item', 'caption',
        'quote', 'code', 'reference', 'unknown',
    ]);
    const DISPLAY_SCOPES = new Set(['block', 'line', 'page']);
    const MIN_FRAME_DURATION_MS = 1000 / 6;
    const ZERO_UNIT_FRAME_DURATION_MS = 500;
    const LEXICAL_READING_UNITS = 3;
    const CLOSING_PUNCTUATION = new Set([
        ',', '.', ';', ':', '!', '?', '%', ')', ']', '}', '>',
        '，', '。', '；', '：', '！', '？', '％', '）', '】', '》', '〉', '」', '』', '〕', '］', '｝',
        '、', '…', '—', '”', '’',
    ]);
    const SENTENCE_END = /[。！？!?；;：:]\s*$/u;
    const HARD_STRUCTURE_TYPES = new Set(['title', 'heading', 'list', 'list_item', 'quote', 'code', 'caption', 'reference']);
    const REFLOW_CONTINUATION_TYPES = new Set(['paragraph', 'unknown']);

    function requireModel() {
        if (!Model && typeof require === 'function') Model = require('./reader-model.js');
        if (!Model) throw new Error('ReaderModelV2 is required');
        return Model;
    }

    function normalizeNodeType(value) {
        return String(value || '').trim().toLowerCase().replace(/[\s-]+/gu, '_');
    }

    function isCjk(char) {
        return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char);
    }

    function isAsciiWordChar(char) {
        return /[A-Za-z0-9]/u.test(char);
    }

    function displayWidth(text) {
        let width = 0;
        for (const char of String(text || '')) {
            if (isCjk(char)) width += 1;
            else if (isAsciiWordChar(char)) width += 0.55;
            else if (/\s/u.test(char)) width += 0.5;
            else width += 1;
        }
        return width;
    }

    function lexicalToken(kind, text) {
        return {
            kind,
            text,
            reading_units: LEXICAL_READING_UNITS,
            display_width: displayWidth(text),
        };
    }

    function normalizeSoftWraps(text) {
        return String(text || '')
            .replace(/\r\n?/gu, '\n')
            .replace(/([^\n])\n([^\n])/gu, (match, before, after) => {
                const separator = isCjk(before) && isCjk(after) ? '' : ' ';
                return `${before}${separator}${after}`;
            })
            .replace(/[ \t\f\v]+/gu, ' ')
            .trim();
    }

    function tokenizeReadingText(text, options = {}) {
        const input = options.normalizeSoftWraps === true ? normalizeSoftWraps(text) : String(text || '').replace(/\r\n?/gu, '\n');
        const tokens = [];
        let i = 0;
        while (i < input.length) {
            const rest = input.slice(i);

            const newline = rest.match(/^\n/u);
            if (newline) {
                tokens.push({ kind: 'newline', text: '\n', reading_units: 0, display_width: 0 });
                i += 1;
                continue;
            }

            const horizontalSpace = rest.match(/^[\t\f\v ]+/u);
            if (horizontalSpace) {
                tokens.push({ kind: 'space', text: ' ', reading_units: 0, display_width: 0.5 });
                i += horizontalSpace[0].length;
                continue;
            }

            const email = rest.match(/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/u);
            if (email) {
                tokens.push(lexicalToken('latin_lexical', email[0]));
                i += email[0].length;
                continue;
            }

            const url = rest.match(/^(?:https?:\/\/|www\.)[^\s<>]+/iu);
            if (url) {
                let value = url[0];
                while (value.length > 1 && CLOSING_PUNCTUATION.has(value.slice(-1)) && /[.,;:!?，。；：！？]/u.test(value.slice(-1))) {
                    value = value.slice(0, -1);
                }
                tokens.push(lexicalToken('latin_lexical', value));
                i += value.length;
                continue;
            }

            const number = rest.match(/^[+-]?(?:\d{1,4}(?:[-/:]\d{1,4})+(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?|\d+(?:[.,]\d+)*(?:%|％)?)/u);
            if (number) {
                tokens.push(lexicalToken('number', number[0]));
                i += number[0].length;
                continue;
            }

            const latin = rest.match(/^[A-Za-z]+(?:['’\-][A-Za-z]+)*(?:\.[A-Za-z]+\.?)*\.?/u);
            if (latin) {
                tokens.push(lexicalToken('latin_lexical', latin[0]));
                i += latin[0].length;
                continue;
            }

            const char = String.fromCodePoint(input.codePointAt(i));
            i += char.length;
            if (/\s/u.test(char)) {
                tokens.push({ kind: 'space', text: ' ', reading_units: 0, display_width: 0.5 });
            } else if (isCjk(char)) {
                tokens.push({ kind: 'cjk', text: char, reading_units: 1, display_width: 1 });
            } else {
                tokens.push({ kind: 'punctuation', text: char, reading_units: 0, display_width: 1 });
            }
        }
        return tokens;
    }

    function countReadingUnits(text) {
        return tokenizeReadingText(text, { normalizeSoftWraps: true }).reduce((sum, token) => sum + token.reading_units, 0);
    }

    function durationMs(readingUnits, speedPerMinute) {
        const speed = Number(speedPerMinute);
        if (!Number.isFinite(speed) || speed <= 0) throw new Error('speedPerMinute must be positive');
        const units = Math.max(0, Number(readingUnits) || 0);
        return Math.max(units * 60000 / speed, MIN_FRAME_DURATION_MS);
    }

    function frameDurationMs(readingUnits, speedPerMinute) {
        return readingUnits > 0 ? durationMs(readingUnits, speedPerMinute) : ZERO_UNIT_FRAME_DURATION_MS;
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

    function sourceUnitMap(documentView) {
        const model = requireModel();
        return new Map(model.orderedSourceUnits(documentView?.source_units || []).map((unit) => [unit.source_unit_id, unit]));
    }

    function buildReadingElements(documentView, nodes) {
        const model = requireModel();
        const units = sourceUnitMap(documentView);
        return model.orderedNodes(nodes).map((node) => {
            const nodeType = normalizeNodeType(node.node_type);
            if (EXCLUDED_PADDLE_NODE_TYPES.has(nodeType)) return null;
            const manual = MANUAL_NODE_TYPES.has(nodeType);
            const text = typeof node.text === 'string' ? normalizeSoftWraps(node.text) : '';
            const identity = identityForNode(documentView, node);
            const sourceUnit = identity.source_unit_id ? units.get(identity.source_unit_id) : null;
            return {
                element_id: `reading-element:${documentView.candidate_id}:${node.node_id}`,
                kind: manual ? 'manual' : 'text',
                node_type: nodeType,
                text,
                asset_refs: Array.isArray(node.asset_refs) ? [...node.asset_refs] : [],
                reading_units: manual ? 0 : countReadingUnits(text),
                identity,
                source_unit_kind: sourceUnit?.kind || null,
                source_order: sourceUnit ? Number(sourceUnit.source_order) : null,
            };
        }).filter((element) => element && (element.kind === 'manual' || TEXT_NODE_TYPES.has(element.node_type)));
    }

    function isClosingPunctuation(token) {
        return token?.kind === 'punctuation' && CLOSING_PUNCTUATION.has(token.text);
    }

    function trimLineSpaces(line) {
        while (line.tokens.length && line.tokens[0].kind === 'space') line.tokens.shift();
        while (line.tokens.length && line.tokens[line.tokens.length - 1].kind === 'space') line.tokens.pop();
        line.display_width = line.tokens.reduce((sum, token) => sum + token.display_width, 0);
        line.reading_units = line.tokens.reduce((sum, token) => sum + token.reading_units, 0);
        return line;
    }

    function appendToken(line, token, lineWidth) {
        if (token.kind === 'newline') return { accepted: false, forcedBreak: true, retry: false };
        if (token.kind === 'space' && !line.tokens.length) return { accepted: true, ignored: true };
        const projected = line.display_width + token.display_width;
        if (line.tokens.length && token.display_width > 0 && projected > lineWidth) {
            if (isClosingPunctuation(token)) {
                line.tokens.push(token);
                line.display_width = projected;
                line.reading_units += token.reading_units;
                return { accepted: true, overflowPunctuation: true };
            }
            return { accepted: false, forcedBreak: false, retry: true };
        }
        line.tokens.push(token);
        line.display_width = projected;
        line.reading_units += token.reading_units;
        return { accepted: true };
    }

    function tokensToLines(tokens, lineWidth) {
        const width = Math.max(1, Number(lineWidth) || 35);
        const lines = [];
        let line = { tokens: [], display_width: 0, reading_units: 0 };
        const flush = () => {
            trimLineSpaces(line);
            if (line.tokens.length) lines.push(line);
            line = { tokens: [], display_width: 0, reading_units: 0 };
        };
        for (const token of tokens) {
            const result = appendToken(line, token, width);
            if (result.accepted) continue;
            flush();
            if (result.forcedBreak) continue;
            const retry = appendToken(line, token, width);
            if (!retry.accepted) throw new Error('token must fit an empty line without splitting');
        }
        flush();
        return lines;
    }

    function lineText(line) {
        return trimLineSpaces({
            tokens: [...line.tokens],
            display_width: line.display_width,
            reading_units: line.reading_units,
        }).tokens.map((token) => token.text).join('');
    }

    function frameId(element, ordinal) {
        return `playback-frame:${element.identity.candidate_id}:${element.identity.node_id}:${String(ordinal).padStart(4, '0')}`;
    }

    function uniqueSourceSpans(tokens) {
        const seen = new Set();
        const spans = [];
        for (const token of tokens) {
            const identity = token.identity;
            if (!identity) continue;
            const key = `${identity.node_id}\u0000${identity.source_unit_id || ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            spans.push(identity);
        }
        return spans;
    }

    function structuredLineFromTokens(tokens) {
        const text = tokens.map((token) => token.text).join('').trim();
        const sourceSpans = uniqueSourceSpans(tokens);
        const types = [...new Set(tokens.map((token) => token.node_type).filter(Boolean))];
        return {
            text,
            node_type: types.length === 1 ? types[0] : 'mixed',
            identity: sourceSpans[0] || null,
            source_spans: sourceSpans,
            display_width: tokens.reduce((sum, token) => sum + token.display_width, 0),
            reading_units: tokens.reduce((sum, token) => sum + token.reading_units, 0),
        };
    }

    function annotatedTokensForElement(element) {
        return tokenizeReadingText(element.text, { normalizeSoftWraps: true }).map((token) => ({
            ...token,
            node_type: element.node_type,
            identity: element.identity,
            element,
        }));
    }

    function shouldContinueAcrossPage(previous, current) {
        if (!previous || !current) return false;
        if (previous.identity.source_unit_id === current.identity.source_unit_id) return false;
        if (previous.source_unit_kind !== 'physical_page' || current.source_unit_kind !== 'physical_page') return false;
        if (!REFLOW_CONTINUATION_TYPES.has(previous.node_type) || !REFLOW_CONTINUATION_TYPES.has(current.node_type)) return false;
        return !SENTENCE_END.test(previous.text);
    }

    function shouldForceNodeBoundary(previous, current) {
        if (!previous) return false;
        if (HARD_STRUCTURE_TYPES.has(previous.node_type) || HARD_STRUCTURE_TYPES.has(current.node_type)) return true;
        return !shouldContinueAcrossPage(previous, current);
    }

    function buildStructuredLines(elements, lineWidth) {
        const width = Math.max(1, Number(lineWidth) || 35);
        const lines = [];
        let lineTokens = [];
        let lineWidthUsed = 0;
        let previousElement = null;

        const flushLine = () => {
            while (lineTokens.length && lineTokens[0].kind === 'space') lineTokens.shift();
            while (lineTokens.length && lineTokens[lineTokens.length - 1].kind === 'space') lineTokens.pop();
            if (lineTokens.length) lines.push(structuredLineFromTokens(lineTokens));
            lineTokens = [];
            lineWidthUsed = 0;
        };

        for (const element of elements) {
            if (!element.text) continue;
            if (shouldForceNodeBoundary(previousElement, element)) flushLine();
            else if (previousElement && lineTokens.length) {
                const previousText = previousElement.text.slice(-1);
                const currentText = element.text.slice(0, 1);
                if (!(isCjk(previousText) && isCjk(currentText))) {
                    const space = { kind: 'space', text: ' ', reading_units: 0, display_width: 0.5, node_type: element.node_type, identity: element.identity, element };
                    if (lineWidthUsed + space.display_width > width) flushLine();
                    if (lineTokens.length) {
                        lineTokens.push(space);
                        lineWidthUsed += space.display_width;
                    }
                }
            }

            for (const token of annotatedTokensForElement(element)) {
                if (token.kind === 'newline') {
                    flushLine();
                    continue;
                }
                if (token.kind === 'space' && !lineTokens.length) continue;
                const projected = lineWidthUsed + token.display_width;
                if (lineTokens.length && token.display_width > 0 && projected > width && !isClosingPunctuation(token)) flushLine();
                lineTokens.push(token);
                lineWidthUsed += token.display_width;
            }
            previousElement = element;
        }
        flushLine();
        return lines;
    }

    function makeTimedFrame(element, ordinal, lines, options) {
        const normalizedLines = lines.filter((line) => String(line.text || '').trim());
        if (!normalizedLines.length) return null;
        const normalizedText = normalizedLines.map((line) => line.text).join('\n');
        const actualUnits = countReadingUnits(normalizedText);
        const sourceSpans = [];
        const seen = new Set();
        for (const line of normalizedLines) {
            for (const identity of line.source_spans || []) {
                const key = `${identity.node_id}\u0000${identity.source_unit_id || ''}`;
                if (seen.has(key)) continue;
                seen.add(key);
                sourceSpans.push(identity);
            }
        }
        return {
            frame_id: frameId(element, ordinal),
            kind: 'timed_text',
            node_type: normalizedLines.length === 1 ? normalizedLines[0].node_type : 'mixed',
            text: normalizedText,
            lines: normalizedLines,
            source_spans: sourceSpans,
            reading_units: actualUnits,
            duration_ms: frameDurationMs(actualUnits, options.speedPerMinute),
            identity: sourceSpans[0] || element.identity,
            frame_ordinal: ordinal,
        };
    }

    function manualFrame(element) {
        return {
            frame_id: frameId(element, 0),
            kind: 'manual',
            node_type: element.node_type,
            text: element.text,
            asset_refs: [...element.asset_refs],
            reading_units: 0,
            duration_ms: null,
            auto_advance: false,
            identity: element.identity,
            source_spans: [element.identity],
            frame_ordinal: 0,
        };
    }

    function groupLinesIntoFrames(lines, anchorElement, options, ordinalStart = 0) {
        const maxLines = Math.max(1, Number(options.maxLines) || 3);
        const frames = [];
        for (let i = 0; i < lines.length; i += maxLines) {
            const frame = makeTimedFrame(anchorElement, ordinalStart + frames.length, lines.slice(i, i + maxLines), options);
            if (frame) frames.push(frame);
        }
        return frames;
    }

    function buildGroupedTextFrames(elements, options) {
        const frames = [];
        let textRun = [];
        let ordinal = 0;

        const flushRun = () => {
            if (!textRun.length) return;
            const anchor = textRun[0];
            const lines = buildStructuredLines(textRun, options.lineWidth);
            const emitted = groupLinesIntoFrames(lines, anchor, options, ordinal);
            frames.push(...emitted);
            ordinal += emitted.length;
            textRun = [];
        };

        for (const element of elements) {
            if (element.kind === 'manual') {
                flushRun();
                frames.push(manualFrame(element));
            } else if (element.text) {
                textRun.push(element);
            }
        }
        flushRun();
        return frames;
    }

    function framesForElement(element, options) {
        if (element.kind === 'manual') return [manualFrame(element)];
        if (!element.text) return [];
        const lines = buildStructuredLines([element], options.lineWidth);
        if (options.displayScope === 'block') return [makeTimedFrame(element, 0, lines, options)].filter(Boolean);
        return groupLinesIntoFrames(lines, element, options);
    }

    function hasPhysicalPageSemantics(documentView) {
        const model = requireModel();
        const units = model.orderedSourceUnits(documentView?.source_units || []);
        const physical = units.filter((unit) => unit.kind === 'physical_page');
        const reflowable = units.filter(model.isReflowableSourceUnit);
        return physical.length > 0 && reflowable.length === 0;
    }

    function buildPageFrames(documentView, elements, options) {
        void documentView;
        return buildGroupedTextFrames(elements, options);
    }

    function buildPlaybackFrames(documentView, nodes, options = {}) {
        const displayScope = options.displayScope || 'block';
        if (!DISPLAY_SCOPES.has(displayScope)) throw new Error('displayScope must be block, line, or page');
        const normalizedOptions = {
            displayScope,
            lineWidth: Math.max(1, Number(options.lineWidth) || 35),
            maxLines: Math.max(1, Number(options.maxLines) || 3),
            speedPerMinute: Number(options.speedPerMinute) || 5000,
        };
        const elements = buildReadingElements(documentView, nodes);
        const frames = displayScope === 'block'
            ? elements.flatMap((element) => framesForElement(element, normalizedOptions))
            : buildGroupedTextFrames(elements, normalizedOptions);
        return { elements, frames, options: normalizedOptions };
    }

    function installPlaybackRenderer(root) {
        const Controller = root?.ReaderSpeedPlaybackUI?.ReaderSpeedPlaybackUIController;
        if (!Controller || Controller.prototype.__phase24cRendererInstalled) return false;
        const original = Controller.prototype.renderFrame;
        Controller.prototype.renderFrame = function renderStructuredPlaybackFrame(frame, target) {
            if (!target || frame?.kind === 'manual' || !Array.isArray(frame?.lines)) {
                return original.call(this, frame, target);
            }
            while (target.firstChild) target.removeChild(target.firstChild);
            target.dataset.playbackNodeType = frame.node_type || 'paragraph';
            const container = this.document.createElement('div');
            container.className = 'reader-playback-frame-text reader-playback-frame-structured';
            for (const line of frame.lines) {
                const row = this.document.createElement('div');
                row.className = `reader-playback-line reader-playback-line-${String(line.node_type || 'paragraph').replace(/[^a-z0-9_-]/giu, '-')}`;
                row.textContent = line.text || '';
                container.appendChild(row);
            }
            target.appendChild(container);
        };
        Controller.prototype.__phase24cRendererInstalled = true;
        return true;
    }

    return {
        DISPLAY_SCOPES,
        EXCLUDED_PADDLE_NODE_TYPES,
        LEXICAL_READING_UNITS,
        MANUAL_NODE_TYPES,
        MIN_FRAME_DURATION_MS,
        ZERO_UNIT_FRAME_DURATION_MS,
        buildGroupedTextFrames,
        buildPageFrames,
        buildPlaybackFrames,
        buildReadingElements,
        buildStructuredLines,
        countReadingUnits,
        displayWidth,
        durationMs,
        frameDurationMs,
        hasPhysicalPageSemantics,
        installPlaybackRenderer,
        normalizeNodeType,
        normalizeSoftWraps,
        tokenizeReadingText,
        tokensToLines,
    };
});