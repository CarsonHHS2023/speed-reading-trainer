(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.ReaderSemanticLayoutHarmonizerV2 = api;
        if (root.document) api.install({ root });
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const STYLE_ID = 'readerSemanticLayoutHarmonizerStyles';
    const INSTALL_RETRY_MS = 20;
    const INSTALL_MAX_ATTEMPTS = 500;
    const BODY_TEXT_TYPES = new Set(['paragraph', 'list_item', 'quote', 'reference']);
    const TEXT_FLOW_TYPES = new Set(['heading', 'paragraph', 'list', 'list_item', 'quote', 'reference', 'caption', 'code', 'formula']);
    const VISUAL_FLOW_TYPES = new Set(['figure', 'table']);
    const PAGE_FURNITURE_TYPES = new Set(['header', 'footer', 'footnote']);
    const INLINE_MATH_TEXT_TYPES = new Set(['heading', 'paragraph', 'list_item', 'quote', 'reference', 'caption']);
    const DEFAULT_TARGET_FRAME = Object.freeze([0.10, 0.90]);
    const CENTER_VISUAL_MIN_WIDTH = 0.28;
    const BODY_FONT_PX = 16;
    const TOP_MARGIN_MIN_PX = 42;
    const BOTTOM_MARGIN_PX = 48;

    const STYLE_TEXT = `
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] {
    --reader-semantic-body-font-size: ${BODY_FONT_PX}px;
}
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-semantic-page-element--harmonized-text {
    overflow: visible !important;
}
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-semantic-page-element--harmonized-text > .reader-v2-node {
    height: auto;
    min-height: 0;
    margin: 0;
    overflow: visible;
}
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-semantic-page-element--body .reader-v2-node-text {
    margin: 0;
    font-size: var(--reader-semantic-body-font-size);
    line-height: 1.68;
    white-space: normal;
    overflow-wrap: break-word;
    word-break: normal;
    text-align: justify;
    text-justify: inter-ideograph;
}
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-semantic-page-element--heading .reader-v2-node-text {
    margin: 0;
    white-space: normal;
    overflow-wrap: break-word;
    line-height: 1.35;
}
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-semantic-page-element--heading[data-reader-heading-level="1"] .reader-v2-node-text {
    font-size: 1.7em;
    font-weight: 750;
    text-align: center;
}
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-semantic-page-element--heading[data-reader-heading-level="2"] .reader-v2-node-text {
    font-size: 1.42em;
    font-weight: 720;
    text-align: center;
}
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-semantic-page-element--heading[data-reader-heading-level="3"] .reader-v2-node-text {
    font-size: 1.2em;
    font-weight: 700;
    text-align: left;
}
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-semantic-page-element--heading:not([data-reader-heading-level]),
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-semantic-page-element--heading[data-reader-heading-level="4"],
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-semantic-page-element--heading[data-reader-heading-level="5"],
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-semantic-page-element--heading[data-reader-heading-level="6"] {
    font-size: 1.08em;
    font-weight: 700;
}
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-semantic-page-element--caption .reader-v2-node-text {
    margin: 0;
    font-size: 0.86em;
    line-height: 1.45;
    white-space: normal;
    text-align: center;
}
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-semantic-page-element--centered-visual > .reader-v2-node,
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-semantic-page-element--centered-visual .reader-v2-asset-slot,
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-semantic-page-element--centered-visual .reader-v2-asset {
    width: 100%;
    height: 100%;
    margin-inline: auto;
}
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-inline-math {
    display: inline-block;
    max-width: 100%;
    margin: 0 0.08em;
    vertical-align: -0.12em;
    white-space: nowrap;
}
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-inline-math .katex {
    font-size: 1em;
}
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-inline-math--display {
    display: block;
    margin: 0.65em auto;
    text-align: center;
    white-space: normal;
}
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] .reader-v2-inline-math--fallback {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    white-space: normal;
}
`;

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function normalizeBbox(value) {
        if (!Array.isArray(value) || value.length !== 4) return null;
        const bbox = value.map(Number);
        if (bbox.some((item) => !Number.isFinite(item))) return null;
        if (bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) return null;
        return [
            clamp(bbox[0], 0, 1),
            clamp(bbox[1], 0, 1),
            clamp(bbox[2], 0, 1),
            clamp(bbox[3], 0, 1),
        ];
    }

    function nodeType(element) {
        return String(element?.node?.node_type || '').toLowerCase();
    }

    function positionedElements(page) {
        return (page?.elements || []).filter((element) => normalizeBbox(element?.normalized_bbox));
    }

    function targetFrameForPage(page, SemanticPage) {
        const layout = SemanticPage?.textMarginLayout?.(page);
        if (layout?.enabled && Array.isArray(layout.targetFrame)) return layout.targetFrame.slice(0, 2);
        return null;
    }

    function shouldHarmonizePage(page, SemanticPage) {
        if (!page || page.presentation_mode === 'source_rendering' || page.page_kind === 'cover') return false;
        return Boolean(targetFrameForPage(page, SemanticPage));
    }

    function centeredVisualBbox(bbox, targetFrame) {
        const normalized = normalizeBbox(bbox);
        if (!normalized) return null;
        const [targetLeft, targetRight] = targetFrame;
        const [x1, y1, x2, y2] = normalized;
        const targetWidth = targetRight - targetLeft;
        const sourceWidth = x2 - x1;
        const width = Math.min(sourceWidth, targetWidth);
        if (width < CENTER_VISUAL_MIN_WIDTH && sourceWidth <= targetWidth) return normalized;
        const left = targetLeft + ((targetWidth - width) / 2);
        return [left, y1, left + width, y2];
    }

    function canonicalHorizontalBbox(element, targetFrame = DEFAULT_TARGET_FRAME) {
        const bbox = normalizeBbox(element?.normalized_bbox);
        if (!bbox) return null;
        const type = nodeType(element);
        const [targetLeft, targetRight] = targetFrame;
        const [, y1, , y2] = bbox;
        if (BODY_TEXT_TYPES.has(type) || type === 'heading' || type === 'caption' || type === 'formula' || type === 'list') {
            return [targetLeft, y1, targetRight, y2];
        }
        if (VISUAL_FLOW_TYPES.has(type)) return centeredVisualBbox(bbox, targetFrame);
        return bbox;
    }

    function formulaUsesTextLayout(slot) {
        if (!slot) return false;
        if (slot.dataset?.readerFormulaLayout === 'text') return true;
        const child = slot.firstElementChild || slot.children?.[0] || null;
        return Boolean(child?.dataset?.formulaRendering);
    }

    function runtimeHorizontalBbox(element, slot, targetFrame) {
        const type = nodeType(element);
        if (type === 'formula' && !formulaUsesTextLayout(slot)) {
            return centeredVisualBbox(element?.normalized_bbox, targetFrame);
        }
        return canonicalHorizontalBbox(element, targetFrame);
    }

    function runtimeFlowType(type, slot) {
        if (type === 'formula') return formulaUsesTextLayout(slot) ? 'formula' : 'figure';
        return type;
    }

    function runtimeTextFlow(type, slot) {
        if (type === 'formula') return formulaUsesTextLayout(slot);
        return TEXT_FLOW_TYPES.has(type);
    }

    function isFlowType(type) {
        return TEXT_FLOW_TYPES.has(type) || VISUAL_FLOW_TYPES.has(type);
    }

    function flowGapBounds(previousType, currentType) {
        if (currentType === 'caption' && VISUAL_FLOW_TYPES.has(previousType)) return { minimum: 6, maximum: 13 };
        if (currentType === 'heading') return { minimum: 19, maximum: 34 };
        if (previousType === 'heading') return { minimum: 10, maximum: 22 };
        if (previousType === 'formula' || currentType === 'formula') return { minimum: 12, maximum: 24 };
        if (VISUAL_FLOW_TYPES.has(previousType) || VISUAL_FLOW_TYPES.has(currentType)) return { minimum: 14, maximum: 28 };
        return { minimum: 10, maximum: 22 };
    }

    function compactSourceGap(sourceGapPx, previousType, currentType) {
        const bounds = flowGapBounds(previousType, currentType);
        return clamp(Number.isFinite(sourceGapPx) ? sourceGapPx : bounds.minimum, bounds.minimum, bounds.maximum);
    }

    function computeFlowPlan(entries, baseHeight, options = {}) {
        const pageHeight = Math.max(1, Number(baseHeight) || 1);
        const sorted = (entries || [])
            .filter((entry) => normalizeBbox(entry?.bbox) && isFlowType(entry?.type))
            .slice()
            .sort((left, right) => left.bbox[1] - right.bbox[1] || left.index - right.index);
        if (!sorted.length) return { placements: [], contentBottom: 0, requiredHeight: 0 };

        const placements = [];
        let previous = null;
        let previousBottom = 0;
        const firstMax = Math.max(TOP_MARGIN_MIN_PX, pageHeight * 0.14);
        for (const entry of sorted) {
            const bbox = normalizeBbox(entry.bbox);
            const sourceTop = bbox[1] * pageHeight;
            const sourceBottom = bbox[3] * pageHeight;
            const sourceHeight = Math.max(1, sourceBottom - sourceTop);
            const renderedHeight = Math.max(1, Number(entry.renderedHeight) || sourceHeight);
            let top;
            if (!previous) {
                top = clamp(sourceTop, TOP_MARGIN_MIN_PX, firstMax);
            } else {
                const previousSourceBottom = previous.bbox[3] * pageHeight;
                const sourceGap = sourceTop - previousSourceBottom;
                top = previousBottom + compactSourceGap(sourceGap, previous.type, entry.type);
            }
            const bottom = top + renderedHeight;
            placements.push({ ...entry, top, height: renderedHeight, bottom });
            previous = entry;
            previousBottom = bottom;
        }
        return {
            placements,
            contentBottom: previousBottom,
            requiredHeight: previousBottom + Number(options.bottomMargin ?? BOTTOM_MARGIN_PX),
        };
    }

    function ensureStyles(root) {
        const documentObject = root?.document;
        if (!documentObject?.createElement) return false;
        if (documentObject.getElementById?.(STYLE_ID)) return true;
        const style = documentObject.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLE_TEXT;
        (documentObject.head || documentObject.documentElement || documentObject.body)?.appendChild?.(style);
        return true;
    }

    function findCanvas(section) {
        if (section?.querySelector) return section.querySelector('.reader-v2-semantic-page-canvas');
        const shell = section?.children?.[1];
        return shell?.children?.[0] || null;
    }

    function findShell(section) {
        if (section?.querySelector) return section.querySelector('.reader-v2-semantic-page-shell');
        return section?.children?.[1] || null;
    }

    function addClass(element, className) {
        if (element?.classList?.add) {
            element.classList.add(className);
            return;
        }
        const classes = new Set(String(element?.className || '').split(/\s+/).filter(Boolean));
        classes.add(className);
        if (element) element.className = [...classes].join(' ');
    }

    function applyHorizontalLayout(slot, element, targetFrame, textFlow) {
        const bbox = runtimeHorizontalBbox(element, slot, targetFrame);
        if (!slot || !bbox) return bbox;
        const [x1, , x2] = bbox;
        slot.style.left = `${x1 * 100}%`;
        slot.style.width = `${(x2 - x1) * 100}%`;
        const type = nodeType(element);
        slot.dataset.readerNodeType = type;
        slot.dataset.readerSourceBbox = normalizeBbox(element.normalized_bbox).join(',');
        if (type === 'heading') {
            addClass(slot, 'reader-v2-semantic-page-element--heading');
            const level = Number(element?.node?.heading_level);
            if (Number.isInteger(level) && level >= 1 && level <= 6) slot.dataset.readerHeadingLevel = String(level);
        }
        if (BODY_TEXT_TYPES.has(type) || type === 'list') addClass(slot, 'reader-v2-semantic-page-element--body');
        if (type === 'caption') addClass(slot, 'reader-v2-semantic-page-element--caption');
        if (textFlow) addClass(slot, 'reader-v2-semantic-page-element--harmonized-text');
        if (!textFlow && (VISUAL_FLOW_TYPES.has(type) || type === 'formula') && Math.abs(bbox[0] - element.normalized_bbox[0]) > 1e-9) {
            addClass(slot, 'reader-v2-semantic-page-element--centered-visual');
        }
        return bbox;
    }

    function renderedTextHeight(slot, fallback) {
        const candidates = [slot?.scrollHeight, slot?.offsetHeight];
        const child = slot?.firstElementChild || slot?.children?.[0];
        candidates.push(child?.scrollHeight, child?.offsetHeight);
        const finite = candidates.map(Number).filter(Number.isFinite);
        const measured = finite.length ? Math.max(...finite) : 0;
        return measured > 0 ? measured : fallback;
    }

    function canonicalPageHeight(shell, page, SemanticPage) {
        const width = Number(shell?.clientWidth || shell?.offsetWidth || shell?.getBoundingClientRect?.().width || 0);
        const aspect = Number(SemanticPage?.pageAspectRatio?.(page?.source_unit));
        if (width > 0 && aspect > 0) return width / aspect;
        const height = Number(shell?.clientHeight || shell?.offsetHeight || shell?.getBoundingClientRect?.().height || 0);
        return height > 0 ? height : 900;
    }

    function harmonizeSection(section, page, SemanticPage) {
        if (!section || !shouldHarmonizePage(page, SemanticPage)) return false;
        const canvas = findCanvas(section);
        const shell = findShell(section);
        if (!canvas || !shell) return false;
        const targetFrame = targetFrameForPage(page, SemanticPage) || DEFAULT_TARGET_FRAME;
        const elements = positionedElements(page);
        const slots = Array.from(canvas.children || []);
        if (!elements.length || slots.length < elements.length) return false;

        const baseHeight = canonicalPageHeight(shell, page, SemanticPage);
        const entries = [];
        for (let index = 0; index < elements.length; index += 1) {
            const element = elements[index];
            const slot = slots[index];
            const sourceBbox = normalizeBbox(element.normalized_bbox);
            const type = nodeType(element);
            const textFlow = runtimeTextFlow(type, slot);
            const flowType = runtimeFlowType(type, slot);
            applyHorizontalLayout(slot, element, targetFrame, textFlow);
            if (!isFlowType(flowType) || PAGE_FURNITURE_TYPES.has(type)) continue;

            const sourceHeight = Math.max(1, (sourceBbox[3] - sourceBbox[1]) * baseHeight);
            let renderedHeight = sourceHeight;
            if (textFlow) {
                slot.style.height = 'auto';
                slot.style.overflow = 'visible';
                renderedHeight = renderedTextHeight(slot, sourceHeight);
            } else {
                slot.style.height = `${sourceHeight}px`;
            }
            entries.push({ index, slot, element, type: flowType, bbox: sourceBbox, renderedHeight, textFlow });
        }

        const plan = computeFlowPlan(entries, baseHeight);
        for (const placement of plan.placements) {
            placement.slot.style.top = `${Math.round(placement.top * 100) / 100}px`;
            if (placement.textFlow) placement.slot.style.height = 'auto';
        }

        const requiredHeight = Math.max(baseHeight, plan.requiredHeight || 0);
        shell.style.height = requiredHeight > baseHeight + 1 ? `${Math.ceil(requiredHeight)}px` : '';
        section.dataset.readerLayoutHarmonized = '1';
        section.dataset.readerLayoutBaseHeight = String(Math.round(baseHeight));
        section.dataset.readerLayoutHeight = String(Math.round(requiredHeight));
        return true;
    }

    function scheduleAfterLayout(root, callback) {
        const schedule = typeof root?.requestAnimationFrame === 'function'
            ? root.requestAnimationFrame.bind(root)
            : (fn) => (root?.setTimeout || setTimeout)(fn, 0);
        schedule(() => schedule(callback));
    }

    function observeSectionResize(root, section, page, SemanticPage) {
        const ResizeObserverCtor = root?.ResizeObserver;
        const shell = findShell(section);
        if (!ResizeObserverCtor || !shell || shell.__readerSemanticLayoutObserver) return false;
        let lastWidth = Number(shell.clientWidth || 0);
        const observer = new ResizeObserverCtor(() => {
            const width = Number(shell.clientWidth || 0);
            if (!width || Math.abs(width - lastWidth) < 1) return;
            lastWidth = width;
            scheduleAfterLayout(root, () => harmonizeSection(section, page, SemanticPage));
        });
        observer.observe(shell);
        shell.__readerSemanticLayoutObserver = observer;
        return true;
    }

    function patchSemanticRenderer(root) {
        const SemanticPage = root?.ReaderSemanticPageV2;
        if (!SemanticPage?.renderSemanticPage) return false;
        if (SemanticPage.__readerLayoutHarmonizerInstalled) return true;
        const original = SemanticPage.renderSemanticPage;
        SemanticPage.renderSemanticPage = function renderSemanticPageWithHarmonizedLayout(options = {}) {
            const section = original.call(this, options);
            const page = options.page;
            if (section && shouldHarmonizePage(page, SemanticPage)) {
                scheduleAfterLayout(root, () => {
                    harmonizeSection(section, page, SemanticPage);
                    observeSectionResize(root, section, page, SemanticPage);
                });
            }
            return section;
        };
        SemanticPage.__readerLayoutHarmonizerInstalled = true;
        SemanticPage.__readerLayoutHarmonizerOriginalRender = original;
        return true;
    }

    function parseInlineMathSegments(value) {
        const text = String(value || '');
        const segments = [];
        let cursor = 0;
        let textStart = 0;

        function pushText(end) {
            if (end > textStart) segments.push({ kind: 'text', text: text.slice(textStart, end) });
        }

        while (cursor < text.length) {
            let open = null;
            let close = null;
            let displayMode = false;
            if (text.startsWith('$$', cursor)) {
                open = '$$'; close = '$$'; displayMode = true;
            } else if (text.startsWith('\\[', cursor)) {
                open = '\\['; close = '\\]'; displayMode = true;
            } else if (text.startsWith('\\(', cursor)) {
                open = '\\('; close = '\\)'; displayMode = false;
            } else if (text[cursor] === '$' && text[cursor - 1] !== '\\') {
                open = '$'; close = '$'; displayMode = false;
            }
            if (!open) {
                cursor += 1;
                continue;
            }

            const sourceStart = cursor + open.length;
            let closeIndex = sourceStart;
            while (closeIndex < text.length) {
                closeIndex = text.indexOf(close, closeIndex);
                if (closeIndex < 0) break;
                if (close === '$' && text[closeIndex - 1] === '\\') {
                    closeIndex += close.length;
                    continue;
                }
                break;
            }
            if (closeIndex < 0 || closeIndex === sourceStart) {
                cursor += open.length;
                continue;
            }

            const source = text.slice(sourceStart, closeIndex).trim();
            if (!source || (open === '$' && /^\d+(?:[.,]\d+)?$/.test(source))) {
                cursor += open.length;
                continue;
            }

            pushText(cursor);
            const rawEnd = closeIndex + close.length;
            segments.push({
                kind: 'math',
                source,
                raw: text.slice(cursor, rawEnd),
                displayMode,
                delimiter: open,
            });
            cursor = rawEnd;
            textStart = cursor;
        }

        pushText(text.length);
        return segments.some((segment) => segment.kind === 'math') ? segments : [{ kind: 'text', text }];
    }

    function findNodeTextElement(wrapper) {
        if (wrapper?.querySelector) return wrapper.querySelector('.reader-v2-node-text');
        return (wrapper?.children || []).find?.((child) => String(child.className || '').split(/\s+/).includes('reader-v2-node-text')) || null;
    }

    function appendPlainText(documentObject, target, text) {
        if (!text) return;
        if (documentObject.createTextNode) {
            target.appendChild(documentObject.createTextNode(text));
            return;
        }
        const span = documentObject.createElement('span');
        span.textContent = text;
        target.appendChild(span);
    }

    function renderInlineMathInWrapper(controller, node, wrapper, root) {
        const type = String(node?.node_type || '').toLowerCase();
        if (!INLINE_MATH_TEXT_TYPES.has(type) || !node?.text || !wrapper) return false;
        if (controller?.currentFindResult?.()?.node_id === node.node_id) return false;
        const katex = root?.katex;
        if (!katex || typeof katex.render !== 'function') return false;
        const segments = parseInlineMathSegments(node.text);
        if (!segments.some((segment) => segment.kind === 'math')) return false;
        const target = findNodeTextElement(wrapper);
        if (!target) return false;

        const documentObject = controller.document;
        const rendered = [];
        for (const segment of segments) {
            if (segment.kind === 'text') {
                rendered.push(segment);
                continue;
            }
            const span = documentObject.createElement('span');
            span.className = `reader-v2-inline-math${segment.displayMode ? ' reader-v2-inline-math--display' : ''}`;
            try {
                katex.render(segment.source, span, {
                    displayMode: segment.displayMode,
                    throwOnError: true,
                    strict: 'warn',
                    trust: false,
                    output: 'htmlAndMathml',
                });
                rendered.push({ ...segment, element: span });
            } catch (_error) {
                span.className += ' reader-v2-inline-math--fallback';
                span.textContent = segment.raw;
                rendered.push({ ...segment, element: span });
            }
        }

        target.replaceChildren?.();
        while (!target.replaceChildren && target.firstChild) target.removeChild(target.firstChild);
        for (const segment of rendered) {
            if (segment.kind === 'text') appendPlainText(documentObject, target, segment.text);
            else target.appendChild(segment.element);
        }
        wrapper.dataset.readerInlineMath = '1';
        return true;
    }

    function patchReaderInlineMath(root) {
        const Controller = root?.ReaderUIV2?.ReaderV2Controller;
        if (!Controller?.prototype?.renderNode) return false;
        const prototype = Controller.prototype;
        if (prototype.__readerInlineMathInstalled) return true;
        const original = prototype.renderNode;
        prototype.renderNode = function renderNodeWithInlineMath(node) {
            const rendered = original.call(this, node);
            if (String(node?.node_type || '').toLowerCase() !== 'formula') {
                renderInlineMathInWrapper(this, node, rendered, root);
            }
            return rendered;
        };
        prototype.__readerInlineMathInstalled = true;
        prototype.__readerInlineMathOriginalRenderNode = original;
        return true;
    }

    function scheduleReaderPatch(root) {
        if (patchReaderInlineMath(root)) return true;
        if (root.__readerInlineMathPatchScheduled) return false;
        root.__readerInlineMathPatchScheduled = true;
        let attempts = 0;
        function retry() {
            attempts += 1;
            if (patchReaderInlineMath(root) || attempts >= INSTALL_MAX_ATTEMPTS) {
                root.__readerInlineMathPatchScheduled = false;
                return;
            }
            (root.setTimeout || setTimeout)(retry, INSTALL_RETRY_MS);
        }
        retry();
        return false;
    }

    function install(options = {}) {
        const root = options.root || (typeof globalThis !== 'undefined' ? globalThis : null);
        if (!root) return false;
        ensureStyles(root);
        const semanticReady = patchSemanticRenderer(root);
        scheduleReaderPatch(root);
        return semanticReady;
    }

    return {
        BODY_FONT_PX,
        BODY_TEXT_TYPES,
        BOTTOM_MARGIN_PX,
        CENTER_VISUAL_MIN_WIDTH,
        DEFAULT_TARGET_FRAME,
        INLINE_MATH_TEXT_TYPES,
        INSTALL_MAX_ATTEMPTS,
        INSTALL_RETRY_MS,
        PAGE_FURNITURE_TYPES,
        STYLE_ID,
        STYLE_TEXT,
        TEXT_FLOW_TYPES,
        VISUAL_FLOW_TYPES,
        canonicalHorizontalBbox,
        centeredVisualBbox,
        compactSourceGap,
        computeFlowPlan,
        ensureStyles,
        flowGapBounds,
        formulaUsesTextLayout,
        harmonizeSection,
        install,
        nodeType,
        normalizeBbox,
        parseInlineMathSegments,
        patchReaderInlineMath,
        patchSemanticRenderer,
        positionedElements,
        renderInlineMathInWrapper,
        runtimeFlowType,
        runtimeHorizontalBbox,
        runtimeTextFlow,
        shouldHarmonizePage,
        targetFrameForPage,
    };
});
