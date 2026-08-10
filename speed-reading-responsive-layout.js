(function (root, factory) {
    const api = factory(root && root.SpeedReadingAdapter);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.SpeedReadingResponsiveLayout = api;
        if (typeof root.setTimeout === 'function') root.setTimeout(() => api.install(root), 0);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Adapter) {
    'use strict';

    const HARD_STRUCTURE_TYPES = new Set([
        'title', 'heading', 'list', 'list_item', 'toc', 'toc_item',
        'quote', 'code', 'caption', 'reference',
    ]);
    const SINGLE_ROW_TYPES = new Set(['title', 'heading', 'list', 'list_item', 'toc', 'toc_item']);
    const REFLOW_CONTINUATION_TYPES = new Set(['paragraph', 'unknown']);
    const SENTENCE_END = /[。！？!?；;：:]\s*$/u;
    const CLOSING_PUNCTUATION = new Set([
        ',', '.', ';', ':', '!', '?', '%', ')', ']', '}', '>',
        '，', '。', '；', '：', '！', '？', '％', '）', '】', '》', '〉', '」', '』', '〕', '］', '｝',
        '、', '…', '—', '”', '’',
    ]);
    const MIN_WIDTH_PERCENT = 20;
    const MAX_WIDTH_PERCENT = 100;
    const DEFAULT_WIDTH_PERCENT = 100;
    const DEFAULT_SAFE_GUTTER_PX = 48;
    const DEFAULT_SAFE_VERTICAL_GUTTER_PX = 72;
    const DEFAULT_LINE_HEIGHT_RATIO = 1.55;
    const STRUCTURED_ROW_GAP_EM = 0.18;
    const FONT_SCALE_BY_TYPE = Object.freeze({ title: 1.5, heading: 1.22, caption: 0.82, reference: 0.82 });
    const HEADING_FONT_SCALE_BY_LEVEL = Object.freeze({ 1: 1.32, 2: 1.22, 3: 1.12, 4: 1.04, 5: 1.04, 6: 1.04 });

    function normalizeNodeType(value) {
        return String(value || '').trim().toLowerCase().replace(/[\s-]+/gu, '_');
    }

    function normalizedHeadingLevel(value) {
        return Number.isInteger(value) && value >= 1 && value <= 6 ? value : null;
    }

    function fontScaleFor(nodeType, headingLevel = null) {
        const type = normalizeNodeType(nodeType);
        const level = normalizedHeadingLevel(headingLevel);
        if (type === 'heading' && level) return HEADING_FONT_SCALE_BY_LEVEL[level];
        return FONT_SCALE_BY_TYPE[type] || 1;
    }

    function fontWeightFor(nodeType, headingLevel, baseWeight = '400') {
        const type = normalizeNodeType(nodeType);
        const level = normalizedHeadingLevel(headingLevel);
        if (type === 'title') return '700';
        if (type === 'heading') return level && level >= 4 ? '650' : '700';
        return baseWeight || '400';
    }

    function clampWidthPercent(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return DEFAULT_WIDTH_PERCENT;
        return Math.max(MIN_WIDTH_PERCENT, Math.min(MAX_WIDTH_PERCENT, numeric));
    }

    function targetWidthPx(availableWidthPx, widthPercent, safeGutterPx = DEFAULT_SAFE_GUTTER_PX) {
        const available = Math.max(0, Number(availableWidthPx) || 0);
        const gutter = Math.max(0, Number(safeGutterPx) || 0);
        return Math.max(1, (available - gutter) * clampWidthPercent(widthPercent) / 100);
    }

    function contentBoxWidth(element, view) {
        const clientWidth = Math.max(0, Number(element?.clientWidth) || 0);
        if (!clientWidth) return 0;
        const computed = element && view?.getComputedStyle ? view.getComputedStyle(element) : null;
        const paddingLeft = Math.max(0, Number.parseFloat(computed?.paddingLeft) || 0);
        const paddingRight = Math.max(0, Number.parseFloat(computed?.paddingRight) || 0);
        return Math.max(1, clientWidth - paddingLeft - paddingRight);
    }

    function contentBoxHeight(element, view) {
        const clientHeight = Math.max(0, Number(element?.clientHeight) || 0);
        if (!clientHeight) return 0;
        const computed = element && view?.getComputedStyle ? view.getComputedStyle(element) : null;
        const paddingTop = Math.max(0, Number.parseFloat(computed?.paddingTop) || 0);
        const paddingBottom = Math.max(0, Number.parseFloat(computed?.paddingBottom) || 0);
        return Math.max(1, clientHeight - paddingTop - paddingBottom);
    }

    function elementRenderedWidth(element) {
        const rectWidth = Math.max(0, Number(element?.getBoundingClientRect?.().width) || 0);
        if (rectWidth) return rectWidth;
        return Math.max(0, Number(element?.clientWidth) || 0);
    }

    function cssVariablePx(element, view, name) {
        const computed = element && view?.getComputedStyle ? view.getComputedStyle(element) : null;
        const raw = computed?.getPropertyValue?.(name);
        return Math.max(0, Number.parseFloat(raw) || 0);
    }

    function playbackSurfaceContentWidth(surface, panel, documentObject, view) {
        const direct = contentBoxWidth(surface, view);
        if (direct) return direct;

        const panelWidth = contentBoxWidth(panel, view);
        if (!panelWidth) return 0;
        const surfaceComputed = surface && view?.getComputedStyle ? view.getComputedStyle(surface) : null;
        const paddingLeft = Math.max(0, Number.parseFloat(surfaceComputed?.paddingLeft) || 0);
        const paddingRight = Math.max(0, Number.parseFloat(surfaceComputed?.paddingRight) || 0);

        const rail = documentObject?.querySelector?.('.reader-study-tools-rail');
        let reservedWidth = elementRenderedWidth(rail);
        if (!reservedWidth) {
            reservedWidth = cssVariablePx(panel, view, '--study-tools-rail-width');
            if (panel?.dataset?.studyToolsExpanded === '1') {
                const drawer = documentObject?.querySelector?.('.reader-study-tools-drawer');
                reservedWidth += elementRenderedWidth(drawer);
            }
        }
        return Math.max(1, panelWidth - reservedWidth - paddingLeft - paddingRight);
    }

    function playbackSurfaceContentHeight(surface, panel, view) {
        const direct = contentBoxHeight(surface, view);
        if (direct) return direct;

        const panelHeight = contentBoxHeight(panel, view);
        if (!panelHeight) return 0;
        const surfaceComputed = surface && view?.getComputedStyle ? view.getComputedStyle(surface) : null;
        const paddingTop = Math.max(0, Number.parseFloat(surfaceComputed?.paddingTop) || 0);
        const paddingBottom = Math.max(0, Number.parseFloat(surfaceComputed?.paddingBottom) || 0);
        return Math.max(1, panelHeight - paddingTop - paddingBottom);
    }

    function pageHeightBudget(availableHeightPx, safeGutterPx = DEFAULT_SAFE_VERTICAL_GUTTER_PX, minimumPx = 1) {
        const available = Math.max(0, Number(availableHeightPx) || 0);
        const gutter = Math.max(0, Number(safeGutterPx) || 0);
        return Math.max(Math.max(1, Number(minimumPx) || 1), available - gutter);
    }

    function pageLineCapacity(availableHeightPx, lineHeightPx, safeGutterPx = DEFAULT_SAFE_VERTICAL_GUTTER_PX) {
        const lineHeight = Math.max(1, Number(lineHeightPx) || 1);
        return Math.max(1, Math.floor(pageHeightBudget(availableHeightPx, safeGutterPx, lineHeight) / lineHeight));
    }

    function createCanvasMeasurer(documentObject, fontOptions) {
        const canvas = documentObject?.createElement?.('canvas');
        const context = canvas?.getContext?.('2d');
        if (!context) return null;
        if (typeof fontOptions === 'string') {
            context.font = fontOptions;
            return (text) => context.measureText(String(text || '')).width;
        }
        const options = fontOptions || {};
        const baseSize = Math.max(1, Number.parseFloat(options.fontSize) || 28);
        const family = options.fontFamily || 'sans-serif';
        const style = options.fontStyle || 'normal';
        const baseWeight = options.fontWeight || '400';
        return (text, nodeType = 'paragraph', headingLevel = null) => {
            const type = normalizeNodeType(nodeType) || 'paragraph';
            const scale = fontScaleFor(type, headingLevel);
            const weight = fontWeightFor(type, headingLevel, baseWeight);
            const familyForType = type === 'code' ? 'ui-monospace, SFMono-Regular, Consolas, monospace' : family;
            context.font = `${style} ${weight} ${baseSize * scale}px ${familyForType}`;
            return context.measureText(String(text || '')).width;
        };
    }

    function sourceKey(identity) {
        return `${identity?.node_id || ''}\u0000${identity?.source_unit_id || ''}`;
    }

    function uniqueSourceSpans(tokens) {
        const seen = new Set();
        const spans = [];
        for (const token of tokens) {
            if (!token.identity) continue;
            const key = sourceKey(token.identity);
            if (seen.has(key)) continue;
            seen.add(key);
            spans.push(token.identity);
        }
        return spans;
    }

    function lastCharacter(text) {
        const chars = Array.from(String(text || ''));
        return chars.length ? chars[chars.length - 1] : '';
    }

    function firstCharacter(text) {
        return Array.from(String(text || ''))[0] || '';
    }

    function isCjk(char) {
        return Boolean(char) && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char);
    }

    function isClosingPunctuationToken(token) {
        return token?.kind === 'punctuation' && CLOSING_PUNCTUATION.has(token.text);
    }

    function shouldContinueAcrossPage(previous, current) {
        if (!previous || !current) return false;
        if (previous.identity?.source_unit_id === current.identity?.source_unit_id) return true;
        if (previous.source_unit_kind !== 'physical_page' || current.source_unit_kind !== 'physical_page') return false;
        if (!REFLOW_CONTINUATION_TYPES.has(previous.node_type) || !REFLOW_CONTINUATION_TYPES.has(current.node_type)) return false;
        return !SENTENCE_END.test(previous.text || '');
    }

    function shouldForceNodeBoundary(previous, current) {
        if (!previous) return false;
        if (HARD_STRUCTURE_TYPES.has(previous.node_type) || HARD_STRUCTURE_TYPES.has(current.node_type)) return true;
        if (REFLOW_CONTINUATION_TYPES.has(previous.node_type) && REFLOW_CONTINUATION_TYPES.has(current.node_type)) {
            return !shouldContinueAcrossPage(previous, current);
        }
        return true;
    }

    function canonicalMeasuredHints(adapter, nodes) {
        const hints = new Map();
        for (const node of nodes || []) {
            const nodeId = String(node?.node_id || '').trim();
            if (!nodeId) continue;
            const semanticType = normalizeNodeType(node?.node_type);
            hints.set(nodeId, {
                heading_level: normalizedHeadingLevel(node?.heading_level),
                toc_title: semanticType === 'toc',
            });
        }
        return hints;
    }

    function decorateMeasuredElements(adapter, elements, nodes, displayScope) {
        const hints = canonicalMeasuredHints(adapter, nodes);
        return (elements || []).map((element) => {
            const nodeId = String(element?.identity?.node_id || '').trim();
            const hint = hints.get(nodeId);
            const headingLevel = normalizedHeadingLevel(element?.heading_level) || hint?.heading_level || null;
            if (displayScope === 'page' && hint?.toc_title) {
                return { ...element, node_type: 'title', heading_level: null, toc_title: true };
            }
            return headingLevel === element?.heading_level
                ? element
                : { ...element, heading_level: headingLevel };
        });
    }

    function measuredTokensForElement(adapter, element, measureText) {
        return adapter.tokenizeReadingText(element.text, { normalizeSoftWraps: true }).map((token) => ({
            ...token,
            measured_width: Math.max(0, Number(measureText(token.text, element.node_type, element.heading_level)) || 0),
            node_type: element.node_type,
            heading_level: normalizedHeadingLevel(element.heading_level),
            toc_title: element.toc_title === true,
            identity: element.identity,
        }));
    }

    function trimMeasuredTokens(tokens) {
        const trimmed = [...tokens];
        while (trimmed.length && trimmed[0].kind === 'space') trimmed.shift();
        while (trimmed.length && trimmed[trimmed.length - 1].kind === 'space') trimmed.pop();
        return trimmed;
    }

    function structuredLine(tokens, extra = {}) {
        const trimmed = trimMeasuredTokens(tokens);
        const sourceSpans = uniqueSourceSpans(trimmed);
        const types = [...new Set(trimmed.map((token) => token.node_type).filter(Boolean))];
        const levels = [...new Set(trimmed.map((token) => token.heading_level).filter((value) => Number.isInteger(value)))];
        return {
            text: trimmed.map((token) => token.text).join(''),
            node_type: types.length === 1 ? types[0] : 'mixed',
            heading_level: levels.length === 1 ? levels[0] : null,
            toc_title: trimmed.some((token) => token.toc_title === true),
            identity: sourceSpans[0] || null,
            source_spans: sourceSpans,
            measured_width_px: trimmed.reduce((sum, token) => sum + token.measured_width, 0),
            reading_units: trimmed.reduce((sum, token) => sum + (Number(token.reading_units) || 0), 0),
            tokens: trimmed,
            ...extra,
        };
    }

    function buildMeasuredLines(adapter, elements, maxWidthPx, measureText) {
        const width = Math.max(1, Number(maxWidthPx) || 1);
        const lines = [];
        let lineTokens = [];
        let lineWidth = 0;
        let previousElement = null;

        const recalculateWidth = () => {
            lineWidth = lineTokens.reduce((sum, token) => sum + token.measured_width, 0);
        };
        const flush = (extra = {}) => {
            const line = structuredLine(lineTokens, extra);
            if (line.text.trim()) lines.push(line);
            lineTokens = [];
            lineWidth = 0;
        };

        for (const element of elements) {
            if (!element?.text) continue;
            const singleRow = SINGLE_ROW_TYPES.has(element.node_type);
            if (singleRow) {
                flush();
                lineTokens = measuredTokensForElement(adapter, element, measureText)
                    .filter((token) => token.kind !== 'newline');
                recalculateWidth();
                flush({ structural_single_row: true });
                previousElement = element;
                continue;
            }

            if (shouldForceNodeBoundary(previousElement, element)) flush();
            else if (previousElement && lineTokens.length) {
                const before = lastCharacter(previousElement.text);
                const after = firstCharacter(element.text);
                if (!(isCjk(before) && isCjk(after))) {
                    const spaceWidth = Math.max(0, Number(measureText(' ', element.node_type, element.heading_level)) || 0);
                    if (lineWidth + spaceWidth > width) flush();
                    if (lineTokens.length) {
                        lineTokens.push({
                            kind: 'space', text: ' ', reading_units: 0, measured_width: spaceWidth,
                            node_type: element.node_type, heading_level: normalizedHeadingLevel(element.heading_level),
                            toc_title: element.toc_title === true, identity: element.identity,
                        });
                        lineWidth += spaceWidth;
                    }
                }
            }

            for (const token of measuredTokensForElement(adapter, element, measureText)) {
                if (token.kind === 'newline') {
                    flush();
                    continue;
                }
                if (token.kind === 'space' && !lineTokens.length) continue;
                const wouldOverflow = lineTokens.length && token.measured_width > 0 && lineWidth + token.measured_width > width;

                // Closing punctuation hangs on the current line. Never move a text
                // token across the boundary to make room for punctuation. If the
                // punctuation itself is the item that exceeds the measured width,
                // keep it with the preceding text and let the paint box overflow.
                if (wouldOverflow && !isClosingPunctuationToken(token)) flush();

                lineTokens.push(token);
                lineWidth += token.measured_width;
            }
            previousElement = element;
        }
        flush();
        return lines;
    }

    function measuredRowMetrics(line, options = {}) {
        const baseFontSizePx = Math.max(1, Number(options.baseFontSizePx) || 28);
        const baseLineHeightPx = Math.max(1, Number(options.baseLineHeightPx) || baseFontSizePx * DEFAULT_LINE_HEIGHT_RATIO);
        const type = normalizeNodeType(line?.node_type) || 'paragraph';
        const level = normalizedHeadingLevel(line?.heading_level);
        const scale = fontScaleFor(type, level);
        const fontSizePx = baseFontSizePx * scale;
        let lineHeightPx;
        let marginBlockPx = 0;

        if (type === 'title') {
            lineHeightPx = fontSizePx * 1.3;
            marginBlockPx = fontSizePx * 0.16;
        } else if (type === 'heading') {
            lineHeightPx = fontSizePx * 1.35;
            marginBlockPx = fontSizePx * 0.10;
        } else if (type === 'caption' || type === 'reference') {
            lineHeightPx = baseLineHeightPx * scale;
        } else {
            lineHeightPx = baseLineHeightPx;
        }

        return {
            font_scale: scale,
            font_size_px: fontSizePx,
            line_height_px: lineHeightPx,
            margin_block_px: marginBlockPx,
            row_height_px: lineHeightPx + marginBlockPx,
        };
    }

    function annotateMeasuredRows(lines, options = {}) {
        return (lines || []).map((line) => ({
            ...line,
            ...measuredRowMetrics(line, options),
        }));
    }

    function measuredPageHeight(lines, rowGapPx = 0) {
        const gap = Math.max(0, Number(rowGapPx) || 0);
        return (lines || []).reduce((sum, line, index) => (
            sum + (index > 0 ? gap : 0) + Math.max(1, Number(line?.row_height_px) || 1)
        ), 0);
    }

    function packMeasuredPageRows(lines, pageHeightPx, rowGapPx = 0) {
        const budget = Math.max(1, Number(pageHeightPx) || 1);
        const gap = Math.max(0, Number(rowGapPx) || 0);
        const pages = [];
        let page = [];
        let used = 0;

        const flush = () => {
            if (page.length) pages.push(page);
            page = [];
            used = 0;
        };

        for (const line of lines || []) {
            const rowHeight = Math.max(1, Number(line?.row_height_px) || 1);
            const separator = page.length ? gap : 0;
            if (page.length && used + separator + rowHeight > budget + 0.01) flush();
            const nextSeparator = page.length ? gap : 0;
            page.push(line);
            used += nextSeparator + rowHeight;
        }
        flush();
        return pages;
    }

    function splitMeasuredLineIntoBlocks(line, maxBlockWidthPx) {
        if (!line?.text) return [];
        if (line.structural_single_row) {
            return [{ ...line, block_index: 0, block_count: 1, x_offset_px: 0 }];
        }

        const width = Math.max(1, Number(maxBlockWidthPx) || 1);
        const blocks = [];
        let blockTokens = [];
        let blockWidth = 0;
        let blockStartX = 0;
        let absoluteX = 0;

        const flush = () => {
            const block = structuredLine(blockTokens, { x_offset_px: blockStartX });
            if (block.text.trim()) blocks.push(block);
            blockTokens = [];
            blockWidth = 0;
        };

        for (const token of line.tokens || []) {
            const tokenWidth = Math.max(0, Number(token.measured_width) || 0);
            if (!blockTokens.length && token.kind === 'space') {
                absoluteX += tokenWidth;
                continue;
            }
            const projected = blockWidth + tokenWidth;
            if (blockTokens.length && tokenWidth > 0 && projected > width && !isClosingPunctuationToken(token)) {
                flush();
                if (token.kind === 'space') {
                    absoluteX += tokenWidth;
                    continue;
                }
                blockStartX = absoluteX;
            }
            if (!blockTokens.length) blockStartX = absoluteX;
            blockTokens.push(token);
            blockWidth += tokenWidth;
            absoluteX += tokenWidth;
        }
        flush();
        blocks.forEach((block, index) => {
            block.block_index = index;
            block.block_count = blocks.length;
        });
        return blocks;
    }

    function frameId(element, ordinal) {
        return `playback-frame:${element.identity.candidate_id}:${element.identity.node_id}:${String(ordinal).padStart(4, '0')}`;
    }

    function timedFrame(adapter, anchor, ordinal, lines, speedPerMinute, placement = {}) {
        const text = lines.map((line) => line.text).join('\n');
        const sourceSpans = [];
        const seen = new Set();
        for (const line of lines) {
            for (const identity of line.source_spans || []) {
                const key = sourceKey(identity);
                if (seen.has(key)) continue;
                seen.add(key);
                sourceSpans.push(identity);
            }
        }
        const readingUnits = adapter.countReadingUnits(text);
        return {
            frame_id: frameId(anchor, ordinal),
            kind: 'timed_text',
            node_type: lines.length === 1 ? lines[0].node_type : 'mixed',
            heading_level: lines.length === 1 ? lines[0].heading_level : null,
            text,
            lines,
            reading_units: readingUnits,
            duration_ms: adapter.frameDurationMs(readingUnits, speedPerMinute),
            auto_advance: true,
            identity: sourceSpans[0] || anchor.identity,
            source_spans: sourceSpans,
            frame_ordinal: ordinal,
            placement,
        };
    }

    function manualFrame(element, virtualPageIndex = 0) {
        return {
            frame_id: frameId(element, 0),
            kind: 'manual',
            node_type: element.node_type,
            text: element.text,
            asset_refs: [...(element.asset_refs || [])],
            reading_units: 0,
            duration_ms: null,
            auto_advance: false,
            identity: element.identity,
            source_spans: [element.identity],
            frame_ordinal: 0,
            placement: {
                display_scope: 'manual',
                virtual_page_index: virtualPageIndex,
                line_index: 0,
                line_span: 1,
                x_px: 0,
                y_px: 0,
                width_px: null,
            },
        };
    }

    function buildMeasuredPlaybackFrames(adapter, documentView, nodes, options = {}) {
        const displayScope = ['block', 'line', 'page'].includes(options.displayScope) ? options.displayScope : 'line';
        const rawElements = adapter.buildReadingElements(documentView, nodes);
        const elements = decorateMeasuredElements(adapter, rawElements, nodes, displayScope);
        const widthPercent = clampWidthPercent(options.widthPercent);
        const contentWidthPx = Math.max(1, Number(options.maxWidthPx) || 1);
        const configuredWidthPx = Math.max(1, contentWidthPx * widthPercent / 100);
        const lineWidthPx = displayScope === 'block' ? contentWidthPx : configuredWidthPx;
        const blockWidthPx = configuredWidthPx;
        const configuredLineCount = displayScope === 'page'
            ? Math.max(1, Number(options.lineCount) || 3)
            : Math.max(1, Number(options.lineCount || options.maxLines) || 3);
        const lineHeightPx = Math.max(1, Number(options.lineHeightPx) || 1);
        const explicitCapacity = Number(options.pageLineCapacity);
        const capacity = Number.isFinite(explicitCapacity) && explicitCapacity > 0
            ? Math.max(1, Math.floor(explicitCapacity))
            : 1;
        const baseFontSizePx = Math.max(
            1,
            Number(options.fontSizePx) || lineHeightPx / DEFAULT_LINE_HEIGHT_RATIO,
        );
        const rowGapPx = Math.max(0, Number(options.rowGapPx) || baseFontSizePx * STRUCTURED_ROW_GAP_EM);
        const fallbackPageHeightPx = capacity * lineHeightPx + Math.max(0, capacity - 1) * rowGapPx;
        const pageHeightPx = Math.max(1, Number(options.pageHeightPx) || fallbackPageHeightPx);
        const speedPerMinute = Number(options.speedPerMinute) || 5000;
        const measureText = options.measureText;
        if (typeof measureText !== 'function') return adapter.buildPlaybackFrames(documentView, nodes, options);

        const frames = [];
        let run = [];
        let ordinal = 0;
        let virtualPageIndex = 0;
        let lineCursor = 0;
        const lineOriginX = Math.max(0, (contentWidthPx - lineWidthPx) / 2);

        const advanceToFreshPage = () => {
            if (lineCursor > 0) virtualPageIndex += 1;
            lineCursor = 0;
        };

        const emitPageFrames = (anchor, lines) => {
            const pages = packMeasuredPageRows(lines, pageHeightPx, rowGapPx);
            for (const slice of pages) {
                frames.push(timedFrame(adapter, anchor, ordinal, slice, speedPerMinute, {
                    display_scope: 'page',
                    virtual_page_index: virtualPageIndex,
                    line_index: 0,
                    line_span: slice.length,
                    x_px: lineOriginX,
                    y_px: 0,
                    width_px: lineWidthPx,
                    line_width_px: lineWidthPx,
                    content_width_px: contentWidthPx,
                    page_height_px: pageHeightPx,
                    content_height_px: measuredPageHeight(slice, rowGapPx),
                    row_gap_px: rowGapPx,
                }));
                ordinal += 1;
                virtualPageIndex += 1;
            }
            lineCursor = 0;
        };

        const emitLineFrames = (anchor, lines) => {
            let index = 0;
            while (index < lines.length) {
                const availableOnPage = Math.max(1, capacity - lineCursor);
                const take = Math.min(configuredLineCount, availableOnPage, lines.length - index);
                const slice = lines.slice(index, index + take);
                frames.push(timedFrame(adapter, anchor, ordinal, slice, speedPerMinute, {
                    display_scope: 'line',
                    virtual_page_index: virtualPageIndex,
                    line_index: lineCursor,
                    line_span: slice.length,
                    x_px: lineOriginX,
                    y_px: lineCursor * lineHeightPx,
                    width_px: lineWidthPx,
                    line_width_px: lineWidthPx,
                    content_width_px: contentWidthPx,
                }));
                ordinal += 1;
                index += take;
                lineCursor += take;
                if (lineCursor >= capacity) {
                    virtualPageIndex += 1;
                    lineCursor = 0;
                }
            }
        };

        const emitBlockFrames = (anchor, lines) => {
            for (const line of lines) {
                const blocks = splitMeasuredLineIntoBlocks(line, blockWidthPx);
                for (const block of blocks) {
                    const atomicStructure = Boolean(line.structural_single_row);
                    frames.push(timedFrame(adapter, anchor, ordinal, [block], speedPerMinute, {
                        display_scope: 'block',
                        virtual_page_index: virtualPageIndex,
                        line_index: lineCursor,
                        line_span: 1,
                        x_px: lineOriginX + Math.max(0, Number(block.x_offset_px) || 0),
                        y_px: lineCursor * lineHeightPx,
                        width_px: atomicStructure ? lineWidthPx : Math.max(1, block.measured_width_px),
                        block_width_px: blockWidthPx,
                        line_width_px: lineWidthPx,
                        content_width_px: contentWidthPx,
                        block_index: block.block_index,
                        block_count: block.block_count,
                        structural_single_row: atomicStructure,
                    }));
                    ordinal += 1;
                }
                lineCursor += 1;
                if (lineCursor >= capacity) {
                    virtualPageIndex += 1;
                    lineCursor = 0;
                }
            }
        };

        const flushRun = () => {
            if (!run.length) return;
            const anchor = run[0];
            const lines = annotateMeasuredRows(
                buildMeasuredLines(adapter, run, lineWidthPx, measureText),
                { baseFontSizePx, baseLineHeightPx: lineHeightPx },
            );
            if (displayScope === 'page') emitPageFrames(anchor, lines);
            else if (displayScope === 'line') emitLineFrames(anchor, lines);
            else emitBlockFrames(anchor, lines);
            run = [];
        };

        for (const element of elements) {
            if (element.kind === 'manual') {
                flushRun();
                advanceToFreshPage();
                frames.push(manualFrame(element, virtualPageIndex));
                virtualPageIndex += 1;
                lineCursor = 0;
            } else if (element.text) {
                run.push(element);
            }
        }
        flushRun();

        return {
            elements,
            frames,
            options: {
                displayScope,
                widthPercent,
                maxWidthPx: contentWidthPx,
                lineWidthPx,
                blockWidthPx,
                lineCount: configuredLineCount,
                ...(displayScope === 'page' ? {} : { maxLines: configuredLineCount }),
                pageLineCapacity: capacity,
                pageHeightPx,
                rowGapPx,
                fontSizePx: baseFontSizePx,
                lineHeightPx,
                speedPerMinute,
            },
        };
    }

    function numericLineHeight(computed, fallbackFontSize) {
        const parsed = Number.parseFloat(computed?.lineHeight);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
        const fontSize = Math.max(1, Number.parseFloat(computed?.fontSize) || Number(fallbackFontSize) || 28);
        return fontSize * DEFAULT_LINE_HEIGHT_RATIO;
    }

    function install(root) {
        const PlaybackUI = root?.ReaderSpeedPlaybackUI;
        const Controller = PlaybackUI?.ReaderSpeedPlaybackUIController;
        const adapter = root?.SpeedReadingAdapter || Adapter;
        if (!Controller || !adapter || Controller.prototype.__responsiveLayoutInstalled) return false;
        const originalAdapterOptions = Controller.prototype.adapterOptions;
        const originalApplyVisualSettings = Controller.prototype.applyVisualSettings;
        const originalRenderFrame = Controller.prototype.renderFrame;

        Controller.prototype.playbackWidthPercent = function playbackWidthPercent() {
            return clampWidthPercent(this.element('widthInput')?.value || DEFAULT_WIDTH_PERCENT);
        };

        Controller.prototype.playbackAvailableWidth = function playbackAvailableWidth() {
            const surface = this.displayScope() === 'page' ? this.element('pageModeDisplay') : this.element('focusModeDisplay');
            const panel = this.document?.querySelector?.('.reading-panel');
            const view = this.document?.defaultView || root;
            return playbackSurfaceContentWidth(surface, panel, this.document, view) || 1;
        };

        Controller.prototype.playbackAvailableHeight = function playbackAvailableHeight() {
            const surface = this.displayScope() === 'page' ? this.element('pageModeDisplay') : this.element('focusModeDisplay');
            const panel = this.document?.querySelector?.('.reading-panel');
            const view = this.document?.defaultView || root;
            return playbackSurfaceContentHeight(surface, panel, view) || 1;
        };

        Controller.prototype.adapterOptions = function responsiveAdapterOptions() {
            const base = originalAdapterOptions.call(this);
            const scope = this.displayScope();
            const percent = this.playbackWidthPercent();
            const lineCount = Math.max(1, Number(this.element('linesInput')?.value || 3));
            const fontSizePx = Math.max(1, Number(this.element('fontInput')?.value || 28));
            const result = {
                ...base,
                widthPercent: percent,
                lineCount,
                maxWidthPx: targetWidthPx(this.playbackAvailableWidth(), 100, DEFAULT_SAFE_GUTTER_PX),
                fontSizePx,
            };
            if (scope === 'page') {
                delete result.maxLines;
                delete result.pageMaxLines;
                result.pageHeightPx = pageHeightBudget(this.playbackAvailableHeight(), 0, 1);
            } else {
                result.maxLines = lineCount;
            }
            return result;
        };

        Controller.prototype.updateSettingsVisibility = function corePlaybackSettingsVisibility() {
            const scope = this.displayScope();
            const pageSettings = this.element('pageSettings');
            const focusSettings = this.element('focusSettings');
            if (pageSettings) pageSettings.style.display = 'none';
            if (focusSettings) focusSettings.style.display = '';

            const widthInput = this.element('widthInput');
            const widthSlider = this.element('widthSlider');
            for (const control of [widthInput, widthSlider]) {
                if (!control) continue;
                control.min = String(MIN_WIDTH_PERCENT);
                control.max = String(MAX_WIDTH_PERCENT);
                const current = clampWidthPercent(control.value);
                control.value = String(current);
            }
            const widthLabel = widthInput?.closest?.('.setting-grid-cell')?.querySelector?.('label');
            if (widthLabel) widthLabel.textContent = scope === 'block' ? '块宽：' : '行宽：';

            const linesCell = this.element('linesInput')?.closest?.('.setting-grid-cell');
            if (linesCell?.style) linesCell.style.display = scope === 'line' ? '' : 'none';

            const scopeSelect = this.element('displayMode');
            const blockOption = Array.from(scopeSelect?.options || []).find((option) => option.value === 'block');
            if (blockOption) blockOption.textContent = '块';
        };

        Controller.prototype.applyVisualSettings = function responsiveVisualSettings() {
            originalApplyVisualSettings.call(this);
            const panel = this.document?.querySelector?.('.reading-panel');
            if (!panel) return;
            panel.style.setProperty('--speed-reading-width-percent', '100%');
            panel.style.removeProperty('--speed-reading-measure');
            for (const id of ['focusText', 'pageText']) {
                const target = this.element(id);
                if (!target?.style) continue;
                target.style.width = '100%';
                target.style.maxWidth = '100%';
                target.style.height = '100%';
                target.style.margin = '0';
                target.style.marginTop = '0';
                target.style.alignSelf = 'stretch';
                target.style.position = 'relative';
                target.style.overflow = 'hidden';
            }
        };

        Controller.prototype.renderFrame = function renderMeasuredPlaybackFrame(frame, target) {
            const result = originalRenderFrame.call(this, frame, target);
            if (!target || frame?.kind !== 'timed_text') return result;

            const container = target.querySelector?.('.reader-playback-frame-text');
            if (!container?.style) return result;
            const placement = frame.placement || {};
            const scope = this.displayScope();
            const mode = this.readingMode();
            const width = Math.max(1, Number(placement.width_px) || Number(placement.line_width_px) || 1);

            target.style.position = 'relative';
            target.style.width = '100%';
            target.style.height = '100%';
            container.style.position = 'absolute';
            container.style.margin = '0';
            container.style.animation = 'none';
            container.style.maxWidth = 'none';
            container.style.width = `${width}px`;

            if (scope === 'page') {
                container.style.left = `${Math.max(0, Number(placement.x_px) || 0)}px`;
                container.style.top = '0px';
                container.style.transform = 'none';
            } else if (mode === 'focus') {
                container.style.left = '50%';
                container.style.top = '50%';
                container.style.transform = 'translate(-50%, -50%)';
            } else {
                container.style.left = `${Math.max(0, Number(placement.x_px) || 0)}px`;
                container.style.top = `${Math.max(0, Number(placement.y_px) || 0)}px`;
                container.style.transform = 'none';
            }

            if (Array.isArray(frame.lines)) {
                const rows = target.querySelectorAll?.('.reader-playback-line') || [];
                frame.lines.forEach((line, index) => {
                    const row = rows[index];
                    if (!row) return;
                    if (Number.isInteger(line.heading_level)) {
                        row.dataset.headingLevel = String(line.heading_level);
                        row.classList.add(`reader-playback-line-heading-level-${line.heading_level}`);
                    }
                    if (line.toc_title === true) row.dataset.tocTitle = '1';
                });
            }
            return result;
        };

        Controller.prototype.refreshFrames = function responsiveRefreshFrames(options = {}) {
            if (!this.reader?.openResponse) {
                this.playback.setFrames([], { preserveIdentity: false });
                this.updateControls();
                return [];
            }
            this.updateSettingsVisibility();
            this.applyVisualSettings();
            const settings = this.adapterOptions();
            const target = this.displayScope() === 'page' ? this.element('pageText') : this.element('focusText');
            const view = this.document?.defaultView;
            const computed = target && view?.getComputedStyle ? view.getComputedStyle(target) : null;
            const measureText = createCanvasMeasurer(this.document, {
                fontFamily: computed?.fontFamily,
                fontSize: computed?.fontSize,
                fontStyle: computed?.fontStyle,
                fontWeight: computed?.fontWeight,
            });
            const lineHeightPx = numericLineHeight(computed, this.element('fontInput')?.value || 28);
            const availableHeight = this.playbackAvailableHeight();
            const verticalGutterPx = this.displayScope() === 'page' ? 0 : DEFAULT_SAFE_VERTICAL_GUTTER_PX;
            const capacity = pageLineCapacity(availableHeight, lineHeightPx, verticalGutterPx);
            const pageBudgetPx = pageHeightBudget(availableHeight, verticalGutterPx, lineHeightPx);
            const built = buildMeasuredPlaybackFrames(adapter, this.reader.openResponse, this.reader.nodes || [], {
                ...settings,
                maxWidthPx: Math.max(1, Number(settings.maxWidthPx) || 1),
                pageLineCapacity: capacity,
                pageHeightPx: pageBudgetPx,
                fontSizePx: Math.max(1, Number.parseFloat(computed?.fontSize) || Number(settings.fontSizePx) || 28),
                lineHeightPx,
                measureText,
            });
            this.playback.setFrames(built.frames, { preserveIdentity: options.preserveIdentity !== false });
            this.updateControls();
            return built.frames;
        };

        Controller.prototype.__responsiveLayoutInstalled = true;

        const controller = PlaybackUI?.getDefaultController?.();
        if (controller) {
            controller.updateSettingsVisibility?.();
            if (!controller.__responsiveReflowBound) {
                controller.__responsiveReflowBound = true;
                let pending = null;
                const scheduleReflow = () => {
                    const view = controller.document?.defaultView;
                    if (!controller.isReaderActive?.()) return;
                    if (pending !== null && view?.cancelAnimationFrame) view.cancelAnimationFrame(pending);
                    const run = () => {
                        pending = null;
                        controller.refreshFrames({ preserveIdentity: true });
                        if (controller.playback?.currentFrame?.()) controller.showPlaybackSurface(controller.playback.currentFrame());
                    };
                    pending = view?.requestAnimationFrame ? view.requestAnimationFrame(run) : root.setTimeout(run, 0);
                };
                for (const id of [
                    'fontInput', 'fontSlider', 'fontWeight', 'fontFamily', 'fontFamilyInput', 'fontFamilySelect',
                    'linesInput', 'linesSlider', 'widthInput', 'widthSlider', 'displayMode',
                ]) {
                    const element = controller.element(id);
                    element?.addEventListener('input', scheduleReflow);
                    element?.addEventListener('change', scheduleReflow);
                }
                controller.document?.addEventListener?.('reader-study-tools-layout-change', scheduleReflow);
                const panel = controller.document?.querySelector?.('.reading-panel');
                if (typeof root.ResizeObserver === 'function') {
                    controller.__responsiveResizeObserver = new root.ResizeObserver(scheduleReflow);
                    for (const observed of [panel, controller.element('focusModeDisplay'), controller.element('pageModeDisplay')]) {
                        if (observed) controller.__responsiveResizeObserver.observe(observed);
                    }
                }
            }
        }
        return true;
    }

    return {
        CLOSING_PUNCTUATION,
        DEFAULT_LINE_HEIGHT_RATIO,
        DEFAULT_SAFE_GUTTER_PX,
        DEFAULT_SAFE_VERTICAL_GUTTER_PX,
        DEFAULT_WIDTH_PERCENT,
        HEADING_FONT_SCALE_BY_LEVEL,
        MAX_WIDTH_PERCENT,
        MIN_WIDTH_PERCENT,
        SINGLE_ROW_TYPES,
        STRUCTURED_ROW_GAP_EM,
        annotateMeasuredRows,
        buildMeasuredLines,
        buildMeasuredPlaybackFrames,
        canonicalMeasuredHints,
        clampWidthPercent,
        contentBoxHeight,
        contentBoxWidth,
        createCanvasMeasurer,
        cssVariablePx,
        decorateMeasuredElements,
        elementRenderedWidth,
        fontScaleFor,
        install,
        isClosingPunctuationToken,
        measuredPageHeight,
        measuredRowMetrics,
        normalizeNodeType,
        packMeasuredPageRows,
        pageHeightBudget,
        pageLineCapacity,
        playbackSurfaceContentHeight,
        playbackSurfaceContentWidth,
        shouldForceNodeBoundary,
        splitMeasuredLineIntoBlocks,
        targetWidthPx,
    };
});
