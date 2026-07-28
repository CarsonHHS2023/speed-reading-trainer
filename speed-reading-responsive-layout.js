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
    const REFLOW_CONTINUATION_TYPES = new Set(['paragraph', 'unknown']);
    const SENTENCE_END = /[。！？!?；;：:]\s*$/u;
    const MIN_WIDTH_PERCENT = 30;
    const MAX_WIDTH_PERCENT = 100;
    const DEFAULT_WIDTH_PERCENT = 100;
    const DEFAULT_SAFE_GUTTER_PX = 32;
    const FONT_SCALE_BY_TYPE = Object.freeze({ title: 1.5, heading: 1.22, caption: 0.82, reference: 0.82 });

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
        return (text, nodeType = 'paragraph') => {
            const scale = FONT_SCALE_BY_TYPE[nodeType] || 1;
            const weight = ['title', 'heading'].includes(nodeType) ? '700' : baseWeight;
            const familyForType = nodeType === 'code' ? 'ui-monospace, SFMono-Regular, Consolas, monospace' : family;
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

    function shouldContinueAcrossPage(previous, current) {
        if (!previous || !current) return false;
        if (previous.identity?.source_unit_id === current.identity?.source_unit_id) return false;
        if (previous.source_unit_kind !== 'physical_page' || current.source_unit_kind !== 'physical_page') return false;
        if (!REFLOW_CONTINUATION_TYPES.has(previous.node_type) || !REFLOW_CONTINUATION_TYPES.has(current.node_type)) return false;
        return !SENTENCE_END.test(previous.text || '');
    }

    function shouldForceNodeBoundary(previous, current) {
        if (!previous) return false;
        if (HARD_STRUCTURE_TYPES.has(previous.node_type) || HARD_STRUCTURE_TYPES.has(current.node_type)) return true;
        return !shouldContinueAcrossPage(previous, current);
    }

    function measuredTokensForElement(adapter, element, measureText) {
        return adapter.tokenizeReadingText(element.text, { normalizeSoftWraps: true }).map((token) => ({
            ...token,
            measured_width: Math.max(0, Number(measureText(token.text, element.node_type)) || 0),
            node_type: element.node_type,
            identity: element.identity,
            element,
        }));
    }

    function structuredLine(tokens) {
        const trimmed = [...tokens];
        while (trimmed.length && trimmed[0].kind === 'space') trimmed.shift();
        while (trimmed.length && trimmed[trimmed.length - 1].kind === 'space') trimmed.pop();
        const sourceSpans = uniqueSourceSpans(trimmed);
        const types = [...new Set(trimmed.map((token) => token.node_type).filter(Boolean))];
        return {
            text: trimmed.map((token) => token.text).join(''),
            node_type: types.length === 1 ? types[0] : 'mixed',
            identity: sourceSpans[0] || null,
            source_spans: sourceSpans,
            measured_width_px: trimmed.reduce((sum, token) => sum + token.measured_width, 0),
            reading_units: trimmed.reduce((sum, token) => sum + (Number(token.reading_units) || 0), 0),
        };
    }

    function buildMeasuredLines(adapter, elements, maxWidthPx, measureText) {
        const width = Math.max(1, Number(maxWidthPx) || 1);
        const lines = [];
        let lineTokens = [];
        let lineWidth = 0;
        let previousElement = null;

        const flush = () => {
            const line = structuredLine(lineTokens);
            if (line.text.trim()) lines.push(line);
            lineTokens = [];
            lineWidth = 0;
        };

        for (const element of elements) {
            if (!element?.text) continue;
            if (shouldForceNodeBoundary(previousElement, element)) flush();
            else if (previousElement && lineTokens.length) {
                const before = lastCharacter(previousElement.text);
                const after = firstCharacter(element.text);
                if (!(isCjk(before) && isCjk(after))) {
                    const spaceWidth = Math.max(0, Number(measureText(' ', element.node_type)) || 0);
                    if (lineWidth + spaceWidth > width) flush();
                    if (lineTokens.length) {
                        lineTokens.push({
                            kind: 'space', text: ' ', reading_units: 0, measured_width: spaceWidth,
                            node_type: element.node_type, identity: element.identity, element,
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
                if (lineTokens.length && token.measured_width > 0 && lineWidth + token.measured_width > width) flush();
                lineTokens.push(token);
                lineWidth += token.measured_width;
            }
            previousElement = element;
        }
        flush();
        return lines;
    }

    function frameId(element, ordinal) {
        return `playback-frame:${element.identity.candidate_id}:${element.identity.node_id}:${String(ordinal).padStart(4, '0')}`;
    }

    function timedFrame(adapter, anchor, ordinal, lines, speedPerMinute) {
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
            text,
            lines,
            reading_units: readingUnits,
            duration_ms: adapter.frameDurationMs(readingUnits, speedPerMinute),
            auto_advance: true,
            identity: sourceSpans[0] || anchor.identity,
            source_spans: sourceSpans,
            frame_ordinal: ordinal,
        };
    }

    function manualFrame(element) {
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
        };
    }

    function buildMeasuredPlaybackFrames(adapter, documentView, nodes, options = {}) {
        const elements = adapter.buildReadingElements(documentView, nodes);
        const maxLines = Math.max(1, Number(options.maxLines) || 3);
        const speedPerMinute = Number(options.speedPerMinute) || 5000;
        const measureText = options.measureText;
        if (typeof measureText !== 'function') return adapter.buildPlaybackFrames(documentView, nodes, options);

        const frames = [];
        let run = [];
        let ordinal = 0;
        const flushRun = () => {
            if (!run.length) return;
            const anchor = run[0];
            const lines = buildMeasuredLines(adapter, run, options.maxWidthPx, measureText);
            if (options.displayScope === 'block') {
                for (const element of run) {
                    const elementLines = buildMeasuredLines(adapter, [element], options.maxWidthPx, measureText);
                    if (elementLines.length) frames.push(timedFrame(adapter, element, 0, elementLines, speedPerMinute));
                }
            } else {
                for (let index = 0; index < lines.length; index += maxLines) {
                    frames.push(timedFrame(adapter, anchor, ordinal, lines.slice(index, index + maxLines), speedPerMinute));
                    ordinal += 1;
                }
            }
            run = [];
        };

        for (const element of elements) {
            if (element.kind === 'manual') {
                flushRun();
                frames.push(manualFrame(element));
            } else if (element.text) run.push(element);
        }
        flushRun();
        return {
            elements,
            frames,
            options: {
                displayScope: options.displayScope || 'line',
                widthPercent: clampWidthPercent(options.widthPercent),
                maxWidthPx: Math.max(1, Number(options.maxWidthPx) || 1),
                maxLines,
                speedPerMinute,
            },
        };
    }

    function install(root) {
        const PlaybackUI = root?.ReaderSpeedPlaybackUI;
        const Controller = PlaybackUI?.ReaderSpeedPlaybackUIController;
        const adapter = root?.SpeedReadingAdapter || Adapter;
        if (!Controller || !adapter || Controller.prototype.__responsiveLayoutInstalled) return false;
        const originalAdapterOptions = Controller.prototype.adapterOptions;
        const originalApplyVisualSettings = Controller.prototype.applyVisualSettings;

        Controller.prototype.playbackWidthPercent = function playbackWidthPercent() {
            return clampWidthPercent(this.element('widthInput')?.value || DEFAULT_WIDTH_PERCENT);
        };

        Controller.prototype.playbackAvailableWidth = function playbackAvailableWidth() {
            const surface = this.displayScope() === 'page' ? this.element('pageModeDisplay') : this.element('focusModeDisplay');
            const panel = this.document?.querySelector?.('.reading-panel');
            return Number(surface?.clientWidth || panel?.clientWidth || 1);
        };

        Controller.prototype.adapterOptions = function responsiveAdapterOptions() {
            const base = originalAdapterOptions.call(this);
            const percent = this.playbackWidthPercent();
            return {
                ...base,
                widthPercent: percent,
                maxWidthPx: targetWidthPx(this.playbackAvailableWidth(), percent),
            };
        };

        Controller.prototype.applyVisualSettings = function responsiveVisualSettings() {
            originalApplyVisualSettings.call(this);
            const panel = this.document?.querySelector?.('.reading-panel');
            if (!panel) return;
            const percent = this.playbackWidthPercent();
            panel.style.setProperty('--speed-reading-width-percent', `${percent}%`);
            panel.style.removeProperty('--speed-reading-measure');
        };

        Controller.prototype.refreshFrames = function responsiveRefreshFrames(options = {}) {
            if (!this.reader?.openResponse) {
                this.playback.setFrames([], { preserveIdentity: false });
                this.updateControls();
                return [];
            }
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
            const built = buildMeasuredPlaybackFrames(adapter, this.reader.openResponse, this.reader.nodes || [], {
                ...settings,
                measureText,
            });
            this.playback.setFrames(built.frames, { preserveIdentity: options.preserveIdentity !== false });
            this.updateControls();
            return built.frames;
        };

        Controller.prototype.__responsiveLayoutInstalled = true;

        const controller = PlaybackUI?.getDefaultController?.();
        if (controller && !controller.__responsiveReflowBound) {
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
            for (const id of ['fontInput', 'fontSlider', 'fontWeight']) {
                const element = controller.element(id);
                element?.addEventListener('input', scheduleReflow);
                element?.addEventListener('change', scheduleReflow);
            }
            const panel = controller.document?.querySelector?.('.reading-panel');
            if (panel && typeof root.ResizeObserver === 'function') {
                controller.__responsiveResizeObserver = new root.ResizeObserver(scheduleReflow);
                controller.__responsiveResizeObserver.observe(panel);
            }
        }
        return true;
    }

    return {
        DEFAULT_WIDTH_PERCENT,
        MAX_WIDTH_PERCENT,
        MIN_WIDTH_PERCENT,
        buildMeasuredLines,
        buildMeasuredPlaybackFrames,
        clampWidthPercent,
        createCanvasMeasurer,
        install,
        targetWidthPx,
    };
});
