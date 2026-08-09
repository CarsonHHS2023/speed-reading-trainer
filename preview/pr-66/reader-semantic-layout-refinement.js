(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.ReaderSemanticLayoutRefinementV2 = api;
        if (root.document) api.install({ root });
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const STYLE_ID = 'readerSemanticLayoutRefinementStyles';
    const INSTALL_RETRY_MS = 20;
    const INSTALL_MAX_ATTEMPTS = 500;
    const BODY_FONT_PX = 18;
    const TOP_MARGIN_MIN_PX = 42;
    const BOTTOM_MARGIN_PX = 48;
    const SMALL_VISUAL_MAX_WIDTH = 0.24;
    const SMALL_VISUAL_MAX_HEIGHT = 0.18;
    const INLINE_ROW_MIN_VERTICAL_OVERLAP = 0.36;
    const INLINE_ROW_HORIZONTAL_TOLERANCE = 0.012;
    const INLINE_ROW_MAX_OFFSET_PX = 10;
    const VISUAL_CAPTION_GAP_PX = 6;
    const INLINE_ROW_PEER_TYPES = new Set([
        'paragraph', 'list_item', 'quote', 'reference', 'caption', 'figure', 'table', 'formula',
    ]);

    const STYLE_TEXT = `
.reader-v2-page-semantic_full_page[data-reader-layout-harmonized="1"] {
    --reader-semantic-body-font-size: ${BODY_FONT_PX}px;
}
.reader-v2-page-semantic_full_page[data-reader-layout-refined="1"] .reader-v2-semantic-page-element--inline-row-member {
    overflow: visible;
}
.reader-v2-page-semantic_full_page[data-reader-layout-refined="1"] .reader-v2-semantic-page-element--inline-row-member.reader-v2-semantic-page-element--text {
    height: auto !important;
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

    function nodeId(element) {
        return String(element?.node?.node_id || element?.node_id || '').trim();
    }

    function parentRef(element) {
        return String(element?.node?.parent_ref || '').trim();
    }

    function bboxWidth(bbox) {
        const normalized = normalizeBbox(bbox);
        return normalized ? normalized[2] - normalized[0] : 0;
    }

    function bboxHeight(bbox) {
        const normalized = normalizeBbox(bbox);
        return normalized ? normalized[3] - normalized[1] : 0;
    }

    function verticalOverlapRatio(left, right) {
        const a = normalizeBbox(left);
        const b = normalizeBbox(right);
        if (!a || !b) return 0;
        const overlap = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
        const smaller = Math.min(a[3] - a[1], b[3] - b[1]);
        return smaller > 0 ? overlap / smaller : 0;
    }

    function horizontallyDisjoint(left, right) {
        const a = normalizeBbox(left);
        const b = normalizeBbox(right);
        if (!a || !b) return false;
        return a[2] <= b[0] + INLINE_ROW_HORIZONTAL_TOLERANCE
            || b[2] <= a[0] + INLINE_ROW_HORIZONTAL_TOLERANCE;
    }

    function formulaUsesTextLayout(slot) {
        if (!slot) return false;
        if (slot.dataset?.readerFormulaLayout === 'text') return true;
        const child = slot.firstElementChild || slot.children?.[0] || null;
        return Boolean(child?.dataset?.formulaRendering);
    }

    function runtimeType(element, slot) {
        const type = nodeType(element);
        if (type === 'formula') return formulaUsesTextLayout(slot) ? 'formula' : 'figure';
        return type;
    }

    function isVisualEntry(entry) {
        return entry?.type === 'figure' || entry?.type === 'table';
    }

    function isSmallVisualEntry(entry) {
        return Boolean(
            isVisualEntry(entry)
            && bboxWidth(entry.bbox) <= SMALL_VISUAL_MAX_WIDTH
            && bboxHeight(entry.bbox) <= SMALL_VISUAL_MAX_HEIGHT
        );
    }

    function attachCanonicalVisualCaptions(entries) {
        const list = entries || [];
        const byNodeId = new Map();
        for (const entry of list) {
            entry.visualCaptions = [];
            entry.visualCaptionParentIndex = null;
            const id = entry.nodeId || nodeId(entry.element);
            if (id) byNodeId.set(id, entry);
        }

        let attached = 0;
        for (const entry of list) {
            if (entry.rawType !== 'caption') continue;
            const ref = entry.parentRef || parentRef(entry.element);
            if (!ref) continue;
            const parent = byNodeId.get(ref);
            if (!parent || !isVisualEntry(parent)) continue;
            entry.visualCaptionParentIndex = parent.index;
            parent.visualCaptions.push(entry);
            if (entry.slot?.classList?.remove) {
                entry.slot.classList.remove('reader-v2-semantic-page-element--inline-row-member');
            }
            if (entry.slot?.dataset) delete entry.slot.dataset.readerInlineRow;
            attached += 1;
        }

        for (const entry of list) {
            entry.visualCaptions.sort((left, right) => (
                (left.bbox?.[1] ?? 0) - (right.bbox?.[1] ?? 0)
                || left.index - right.index
            ));
        }
        return attached;
    }

    function canShareInlineRow(left, right) {
        if (!left || !right || left === right) return false;
        if (left.visualCaptionParentIndex !== null || right.visualCaptionParentIndex !== null) return false;
        if (!INLINE_ROW_PEER_TYPES.has(left.type) || !INLINE_ROW_PEER_TYPES.has(right.type)) return false;
        if (!isSmallVisualEntry(left) && !isSmallVisualEntry(right)) return false;
        if (!horizontallyDisjoint(left.bbox, right.bbox)) return false;
        return verticalOverlapRatio(left.bbox, right.bbox) >= INLINE_ROW_MIN_VERTICAL_OVERLAP;
    }

    function pairInlineRows(entries) {
        const candidates = (entries || []).filter((entry) => (
            normalizeBbox(entry?.bbox) && entry.visualCaptionParentIndex === null
        ));
        const used = new Set();
        const pairs = [];
        for (const entry of candidates) {
            if (used.has(entry.index)) continue;
            let best = null;
            let bestScore = -1;
            for (const peer of candidates) {
                if (peer === entry || used.has(peer.index) || !canShareInlineRow(entry, peer)) continue;
                const overlap = verticalOverlapRatio(entry.bbox, peer.bbox);
                const centerA = (entry.bbox[1] + entry.bbox[3]) / 2;
                const centerB = (peer.bbox[1] + peer.bbox[3]) / 2;
                const score = overlap - (Math.abs(centerA - centerB) * 0.25);
                if (score > bestScore) {
                    best = peer;
                    bestScore = score;
                }
            }
            if (!best) continue;
            const members = [entry, best].sort((a, b) => a.bbox[0] - b.bbox[0]);
            pairs.push(members);
            used.add(entry.index);
            used.add(best.index);
        }
        return pairs;
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

    function findShell(section) {
        if (section?.querySelector) return section.querySelector('.reader-v2-semantic-page-shell');
        return section?.children?.[1] || null;
    }

    function findCanvas(section) {
        if (section?.querySelector) return section.querySelector('.reader-v2-semantic-page-canvas');
        return findShell(section)?.children?.[0] || null;
    }

    function positionedElements(page) {
        return (page?.elements || []).filter((element) => normalizeBbox(element?.normalized_bbox));
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

    function sourcePresentationBbox(page, element, SemanticPage) {
        const layout = SemanticPage?.textMarginLayout?.(page);
        const candidate = SemanticPage?.presentationBbox?.(page, element, layout);
        return normalizeBbox(candidate) || normalizeBbox(element?.normalized_bbox);
    }

    function sourceHeightPx(entry, baseHeight) {
        return Math.max(1, bboxHeight(entry.bbox) * baseHeight);
    }

    function measuredHeight(entry, baseHeight) {
        const fallback = sourceHeightPx(entry, baseHeight);
        if (!entry.textFlow) return fallback;
        const slot = entry.slot;
        const child = slot?.firstElementChild || slot?.children?.[0] || null;
        const values = [slot?.scrollHeight, slot?.offsetHeight, child?.scrollHeight, child?.offsetHeight]
            .map(Number)
            .filter(Number.isFinite);
        return values.length ? Math.max(fallback, ...values) : fallback;
    }

    function canonicalBaseHeight(section, shell) {
        const datasetValue = Number(section?.dataset?.readerLayoutBaseHeight);
        if (datasetValue > 0) return datasetValue;
        const width = Number(shell?.clientWidth || shell?.offsetWidth || 0);
        const height = Number(shell?.clientHeight || shell?.offsetHeight || 0);
        if (height > 0) return height;
        return width > 0 ? width / 0.70710678 : 900;
    }

    function buildEntries(section, page, Harmonizer) {
        const canvas = findCanvas(section);
        const elements = positionedElements(page);
        const slots = Array.from(canvas?.children || []);
        if (!canvas || !elements.length || slots.length < elements.length) return [];
        const entries = [];
        for (let index = 0; index < elements.length; index += 1) {
            const element = elements[index];
            const slot = slots[index];
            const rawType = nodeType(element);
            const type = Harmonizer?.runtimeFlowType
                ? Harmonizer.runtimeFlowType(rawType, slot)
                : runtimeType(element, slot);
            const textFlow = Harmonizer?.runtimeTextFlow
                ? Harmonizer.runtimeTextFlow(rawType, slot)
                : !isVisualEntry({ type });
            if (!Harmonizer?.TEXT_FLOW_TYPES?.has?.(type) && !Harmonizer?.VISUAL_FLOW_TYPES?.has?.(type)) continue;
            if (Harmonizer?.PAGE_FURNITURE_TYPES?.has?.(rawType)) continue;
            entries.push({
                index,
                element,
                slot,
                rawType,
                type,
                textFlow,
                bbox: normalizeBbox(element.normalized_bbox),
                nodeId: nodeId(element),
                parentRef: parentRef(element),
                visualCaptions: [],
                visualCaptionParentIndex: null,
            });
        }
        return entries;
    }

    function applyInlineRowHorizontalLayout(pair, page, SemanticPage, rowId) {
        for (const entry of pair) {
            const bbox = sourcePresentationBbox(page, entry.element, SemanticPage);
            if (!bbox) continue;
            entry.slot.style.left = `${bbox[0] * 100}%`;
            entry.slot.style.width = `${(bbox[2] - bbox[0]) * 100}%`;
            if (entry.textFlow) {
                entry.slot.style.height = 'auto';
                entry.slot.style.overflow = 'visible';
            }
            addClass(entry.slot, 'reader-v2-semantic-page-element--inline-row-member');
            entry.slot.dataset.readerInlineRow = String(rowId);
            entry.presentationBbox = bbox;
        }
    }

    function alignCaptionToParent(parent, caption) {
        const parentSlot = parent?.slot;
        const captionSlot = caption?.slot;
        if (!parentSlot || !captionSlot) return false;
        if (parentSlot.style?.left) captionSlot.style.left = parentSlot.style.left;
        if (parentSlot.style?.width) captionSlot.style.width = parentSlot.style.width;
        captionSlot.style.height = 'auto';
        captionSlot.style.overflow = 'visible';
        captionSlot.style.textAlign = 'center';
        const child = captionSlot.firstElementChild || captionSlot.children?.[0] || null;
        if (child?.style) {
            child.style.height = 'auto';
            child.style.overflow = 'visible';
            child.style.textAlign = 'center';
        }
        const text = child?.querySelector?.('.reader-v2-node-text') || null;
        if (text?.style) text.style.textAlign = 'center';
        captionSlot.dataset.readerVisualCaptionParent = parent.nodeId || '';
        captionSlot.dataset.readerVisualCaptionGrouped = '1';
        return true;
    }

    function unionBbox(members) {
        const boxes = members.map((member) => normalizeBbox(member.bbox)).filter(Boolean);
        if (!boxes.length) return null;
        return [
            Math.min(...boxes.map((bbox) => bbox[0])),
            Math.min(...boxes.map((bbox) => bbox[1])),
            Math.max(...boxes.map((bbox) => bbox[2])),
            Math.max(...boxes.map((bbox) => bbox[3])),
        ];
    }

    function flowUnitType(members) {
        if (members.some((member) => member.type === 'heading')) return 'heading';
        if (members.some((member) => isVisualEntry(member))) return 'figure';
        if (members.some((member) => member.type === 'formula')) return 'formula';
        return members[0]?.type || 'paragraph';
    }

    function captionStackLayout(member, baseHeight) {
        const renderedHeight = measuredHeight(member, baseHeight);
        let totalHeight = renderedHeight;
        const captions = [];
        for (const caption of member.visualCaptions || []) {
            const captionHeight = measuredHeight(caption, baseHeight);
            const offset = totalHeight + VISUAL_CAPTION_GAP_PX;
            captions.push({ caption, offset, renderedHeight: captionHeight });
            totalHeight = offset + captionHeight;
        }
        return { renderedHeight, totalHeight, captions };
    }

    function buildFlowUnits(entries, pairs, baseHeight) {
        const pairedByIndex = new Map();
        pairs.forEach((pair, pairIndex) => pair.forEach((entry) => pairedByIndex.set(entry.index, pairIndex)));
        const consumedPairs = new Set();
        const units = [];
        for (const entry of entries) {
            if (entry.visualCaptionParentIndex !== null) continue;
            const pairIndex = pairedByIndex.get(entry.index);
            let members;
            if (pairIndex !== undefined) {
                if (consumedPairs.has(pairIndex)) continue;
                consumedPairs.add(pairIndex);
                members = pairs[pairIndex];
            } else {
                members = [entry];
            }
            const bbox = unionBbox(members);
            if (!bbox) continue;
            const sourceTop = bbox[1];
            let height = 1;
            const memberLayout = members.map((member) => {
                const offset = members.length > 1
                    ? clamp((member.bbox[1] - sourceTop) * baseHeight, 0, INLINE_ROW_MAX_OFFSET_PX)
                    : 0;
                const stack = captionStackLayout(member, baseHeight);
                height = Math.max(height, offset + stack.totalHeight);
                return {
                    member,
                    offset,
                    renderedHeight: stack.renderedHeight,
                    captionLayouts: stack.captions,
                };
            });
            units.push({
                members,
                memberLayout,
                bbox,
                height,
                type: flowUnitType(members),
                index: Math.min(...members.map((member) => member.index)),
            });
        }
        return units.sort((a, b) => a.bbox[1] - b.bbox[1] || a.index - b.index);
    }

    function applyFlowUnits(units, baseHeight, Harmonizer) {
        if (!units.length) return { contentBottom: 0, requiredHeight: 0 };
        const firstMax = Math.max(TOP_MARGIN_MIN_PX, baseHeight * 0.14);
        let previous = null;
        let previousBottom = 0;
        for (const unit of units) {
            const sourceTop = unit.bbox[1] * baseHeight;
            let top;
            if (!previous) {
                top = clamp(sourceTop, TOP_MARGIN_MIN_PX, firstMax);
            } else {
                const sourceGap = sourceTop - (previous.bbox[3] * baseHeight);
                const gap = Harmonizer?.compactSourceGap
                    ? Harmonizer.compactSourceGap(sourceGap, previous.type, unit.type)
                    : clamp(sourceGap, 10, 28);
                top = previousBottom + gap;
            }
            for (const layout of unit.memberLayout) {
                const memberTop = top + layout.offset;
                layout.member.slot.style.top = `${Math.round(memberTop * 100) / 100}px`;
                if (layout.member.textFlow) layout.member.slot.style.height = 'auto';
                for (const captionLayout of layout.captionLayouts || []) {
                    alignCaptionToParent(layout.member, captionLayout.caption);
                    const captionTop = memberTop + captionLayout.offset;
                    captionLayout.caption.slot.style.top = `${Math.round(captionTop * 100) / 100}px`;
                }
                if ((layout.member.visualCaptions || []).length) {
                    layout.member.slot.dataset.readerVisualCaptionCount = String(layout.member.visualCaptions.length);
                }
            }
            previous = unit;
            previousBottom = top + unit.height;
        }
        return {
            contentBottom: previousBottom,
            requiredHeight: previousBottom + BOTTOM_MARGIN_PX,
        };
    }

    function refineSection(root, section, page, SemanticPage, Harmonizer) {
        if (!section || !Harmonizer?.shouldHarmonizePage?.(page, SemanticPage)) return false;
        const shell = findShell(section);
        const entries = buildEntries(section, page, Harmonizer);
        if (!shell || !entries.length) return false;
        const baseHeight = canonicalBaseHeight(section, shell);
        const captionCount = attachCanonicalVisualCaptions(entries);
        const pairs = pairInlineRows(entries);
        pairs.forEach((pair, index) => applyInlineRowHorizontalLayout(pair, page, SemanticPage, index + 1));
        const units = buildFlowUnits(entries, pairs, baseHeight);
        const plan = applyFlowUnits(units, baseHeight, Harmonizer);
        const requiredHeight = Math.max(baseHeight, plan.requiredHeight || 0);
        shell.style.height = requiredHeight > baseHeight + 1 ? `${Math.ceil(requiredHeight)}px` : '';
        section.dataset.readerLayoutRefined = '1';
        section.dataset.readerBodyFontPx = String(BODY_FONT_PX);
        section.dataset.readerInlineRowCount = String(pairs.length);
        section.dataset.readerVisualCaptionGroupedCount = String(captionCount);
        section.dataset.readerLayoutHeight = String(Math.round(requiredHeight));
        return true;
    }

    function scheduleAfterLayout(root, callback) {
        const schedule = typeof root?.requestAnimationFrame === 'function'
            ? root.requestAnimationFrame.bind(root)
            : (fn) => (root?.setTimeout || setTimeout)(fn, 0);
        schedule(() => schedule(callback));
    }

    function observeResize(root, section, page, SemanticPage, Harmonizer) {
        const ResizeObserverCtor = root?.ResizeObserver;
        const shell = findShell(section);
        if (!ResizeObserverCtor || !shell || shell.__readerSemanticRefinementObserver) return false;
        let lastWidth = Number(shell.clientWidth || 0);
        const observer = new ResizeObserverCtor(() => {
            const width = Number(shell.clientWidth || 0);
            if (!width || Math.abs(width - lastWidth) < 1) return;
            lastWidth = width;
            scheduleAfterLayout(root, () => refineSection(root, section, page, SemanticPage, Harmonizer));
        });
        observer.observe(shell);
        shell.__readerSemanticRefinementObserver = observer;
        return true;
    }

    function patchSemanticRenderer(root) {
        const SemanticPage = root?.ReaderSemanticPageV2;
        const Harmonizer = root?.ReaderSemanticLayoutHarmonizerV2;
        if (!SemanticPage?.renderSemanticPage || !Harmonizer?.shouldHarmonizePage) return false;
        if (SemanticPage.__readerLayoutRefinementInstalled) return true;
        const original = SemanticPage.renderSemanticPage;
        SemanticPage.renderSemanticPage = function renderSemanticPageWithRefinement(options = {}) {
            const section = original.call(this, options);
            const page = options.page;
            if (section && Harmonizer.shouldHarmonizePage(page, SemanticPage)) {
                scheduleAfterLayout(root, () => {
                    refineSection(root, section, page, SemanticPage, Harmonizer);
                    observeResize(root, section, page, SemanticPage, Harmonizer);
                });
            }
            return section;
        };
        SemanticPage.__readerLayoutRefinementInstalled = true;
        SemanticPage.__readerLayoutRefinementOriginalRender = original;
        return true;
    }

    function install(options = {}) {
        const root = options.root || (typeof globalThis !== 'undefined' ? globalThis : null);
        if (!root) return false;
        ensureStyles(root);
        if (patchSemanticRenderer(root)) return true;
        if (root.__readerLayoutRefinementRetryScheduled) return false;
        root.__readerLayoutRefinementRetryScheduled = true;
        let attempts = 0;
        function retry() {
            attempts += 1;
            if (patchSemanticRenderer(root) || attempts >= INSTALL_MAX_ATTEMPTS) {
                root.__readerLayoutRefinementRetryScheduled = false;
                return;
            }
            (root.setTimeout || setTimeout)(retry, INSTALL_RETRY_MS);
        }
        retry();
        return false;
    }

    return {
        BODY_FONT_PX,
        BOTTOM_MARGIN_PX,
        INLINE_ROW_MIN_VERTICAL_OVERLAP,
        SMALL_VISUAL_MAX_HEIGHT,
        SMALL_VISUAL_MAX_WIDTH,
        STYLE_ID,
        STYLE_TEXT,
        VISUAL_CAPTION_GAP_PX,
        alignCaptionToParent,
        applyFlowUnits,
        attachCanonicalVisualCaptions,
        bboxHeight,
        bboxWidth,
        buildFlowUnits,
        canShareInlineRow,
        captionStackLayout,
        ensureStyles,
        formulaUsesTextLayout,
        horizontallyDisjoint,
        install,
        isSmallVisualEntry,
        pairInlineRows,
        patchSemanticRenderer,
        refineSection,
        runtimeType,
        sourcePresentationBbox,
        verticalOverlapRatio,
    };
});
