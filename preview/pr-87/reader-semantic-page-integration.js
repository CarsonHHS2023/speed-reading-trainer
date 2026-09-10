(function (root, factory) {
    const api = factory(
        root && root.ReaderUIV2,
        root && root.ReaderSemanticPageV2,
        root && root.ReaderPresentationV2,
    );
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderSemanticPageIntegrationV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ReaderUI, SemanticPage, Presentation) {
    'use strict';

    const SEMANTIC_FULL_PAGE_MODE = 'semantic_full_page';
    const TOC_ITEM_RULE = 'mineru_popo_toc_item';
    const TOC_LIST_RULE = 'mineru_popo_toc_list';
    const TOC_START_ITEM_THRESHOLD = 3;

    function resolveDeps() {
        if (typeof require === 'function') {
            ReaderUI = ReaderUI || require('./reader-ui-v2.js');
            SemanticPage = SemanticPage || require('./reader-semantic-page.js');
            Presentation = Presentation || require('./reader-presentation.js');
        }
        if (!ReaderUI?.ReaderV2Controller || !SemanticPage?.renderSemanticPage || !Presentation) {
            throw new Error('Reader v2 semantic page integration dependencies are required');
        }
        return { ReaderUI, SemanticPage, Presentation };
    }

    function semanticPageDependency() {
        if (!SemanticPage && typeof require === 'function') SemanticPage = require('./reader-semantic-page.js');
        if (!SemanticPage?.pageAspectRatio) throw new Error('ReaderSemanticPageV2 is required');
        return SemanticPage;
    }

    function semanticFullPageMode() {
        return Presentation?.PRESENTATION_MODE_SEMANTIC_FULL_PAGE || SEMANTIC_FULL_PAGE_MODE;
    }

    function isSemanticFullPage(page, presentationState) {
        const expectedMode = semanticFullPageMode();
        return presentationState?.mode === expectedMode
            || page?.kind === expectedMode
            || page?.kind === SEMANTIC_FULL_PAGE_MODE;
    }

    function coverPageForSemanticPage(page) {
        const carrier = (page?.nodes || []).find((node) => (
            node?.metadata?.page_kind === 'cover'
            && node?.metadata?.presentation_mode === 'source_rendering'
            && String(node?.metadata?.source_rendering_asset_id || '').trim()
        ));
        if (!carrier) return page;

        const assetId = String(carrier.metadata.source_rendering_asset_id).trim();
        const displayNode = {
            ...carrier,
            node_type: 'figure',
            text: null,
            asset_refs: [assetId],
            presentation_canonical_node_id: carrier.node_id,
            presentation_role: 'cover_source_rendering',
        };
        return {
            ...page,
            page_kind: 'cover',
            presentation_mode: 'source_rendering',
            cover_asset_id: assetId,
            elements: [{
                element_id: `cover:${page.source_unit_id || carrier.node_id}`,
                kind: 'cover_source_rendering',
                node_id: carrier.node_id,
                node: displayNode,
                display_text: null,
                fragment_index: null,
                normalized_bbox: [0, 0, 1, 1],
                source_unit_id: page.source_unit_id || carrier.source_unit_ids?.[0] || null,
            }],
        };
    }

    function tocParts(page) {
        const nodes = page?.nodes || [];
        const heading = nodes.find((node) => (
            String(node?.node_type || '').toLowerCase() === 'heading'
            && String(node?.text || '').trim() === '目录'
        )) || null;
        const items = nodes.filter((node) => node?.metadata?.recovery_rule === TOC_ITEM_RULE);
        const lists = nodes.filter((node) => node?.metadata?.recovery_rule === TOC_LIST_RULE);
        const listNodeIds = new Set(lists.map((node) => node.node_id));
        return { heading, items, lists, listNodeIds };
    }

    function tocDisplayNode(item) {
        if (!item) return item;
        return {
            ...item,
            node_type: 'paragraph',
            presentation_canonical_node_id: item.node_id,
            presentation_original_node_type: item.node_type,
            presentation_role: 'toc_item',
        };
    }

    function nodeNormalizedBbox(node) {
        const direct = node?.location?.source_anchor?.normalized_bbox;
        const candidates = [direct, ...(node?.source_anchors || []).map((anchor) => anchor?.normalized_bbox)];
        for (const bbox of candidates) {
            if (!Array.isArray(bbox) || bbox.length !== 4) continue;
            const values = bbox.map(Number);
            if (values.every(Number.isFinite) && values[2] > values[0] && values[3] > values[1]) {
                return values.map((value) => Math.max(0, Math.min(1, value)));
            }
        }
        return null;
    }

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function normalizedTocItemText(item) {
        return String(item?.text || '')
            .replace(/^\s*(?:[-*+•·●▪◦]|\d+[.)、])\s*/, '')
            .trim();
    }

    function tocTextIndentDecision(item) {
        const text = normalizedTocItemText(item);
        if (/^第[一二三四五六七八九十百千万0-9]+[章节篇部卷]/.test(text)) {
            return { indentPercent: 0, matched: true };
        }
        if (/^[一二三四五六七八九十]+[、.．)]/.test(text)) {
            return { indentPercent: 5, matched: true };
        }
        if (/^[（(][一二三四五六七八九十0-9]+[）)]/.test(text)) {
            return { indentPercent: 8, matched: true };
        }
        return { indentPercent: 0, matched: false };
    }

    function tocTextIndentPercent(item) {
        return tocTextIndentDecision(item).indentPercent;
    }

    function tocLevelFromMetadata(item) {
        const value = item?.metadata?.toc_level;
        return Number.isInteger(value) && value >= 1 && value <= 12 ? value : null;
    }

    function tocLevelIndentPercent(level) {
        if (!Number.isInteger(level) || level < 1 || level > 12) return null;
        if (level === 1) return 0;
        if (level === 2) return 5;
        return clamp(8 + ((level - 3) * 3), 0, 20);
    }

    function tocCoordinateIndentPercent(item, minimumLeft) {
        if (!Number.isFinite(minimumLeft)) return null;
        const bbox = nodeNormalizedBbox(item);
        if (!bbox) return null;
        const sourceIndent = Math.max(0, bbox[0] - minimumLeft) * 100;
        return sourceIndent >= 1.5 ? clamp(sourceIndent, 0, 12) : null;
    }

    function tocIndentDecision(item, minimumLeft = null) {
        const tocLevel = tocLevelFromMetadata(item);
        const coordinateIndent = tocCoordinateIndentPercent(item, minimumLeft);
        const legacyText = tocTextIndentDecision(item);
        if (tocLevel !== null) {
            return {
                indentPercent: tocLevelIndentPercent(tocLevel),
                source: 'metadata.toc_level',
                tocLevel,
                coordinateIndentPercent: coordinateIndent,
                legacyTextIndentPercent: legacyText.indentPercent,
                legacyTextMatched: legacyText.matched,
            };
        }
        if (coordinateIndent !== null) {
            return {
                indentPercent: coordinateIndent,
                source: 'bbox',
                tocLevel: null,
                coordinateIndentPercent: coordinateIndent,
                legacyTextIndentPercent: legacyText.indentPercent,
                legacyTextMatched: legacyText.matched,
            };
        }
        if (legacyText.matched) {
            return {
                indentPercent: legacyText.indentPercent,
                source: 'legacy_text_pattern',
                tocLevel: null,
                coordinateIndentPercent: null,
                legacyTextIndentPercent: legacyText.indentPercent,
                legacyTextMatched: true,
            };
        }
        return {
            indentPercent: 0,
            source: 'default',
            tocLevel: null,
            coordinateIndentPercent: null,
            legacyTextIndentPercent: 0,
            legacyTextMatched: false,
        };
    }

    function tocLayout(page) {
        const { heading, items } = tocParts(page);
        const measured = [heading, ...items].filter(Boolean).map((node) => ({ node, bbox: nodeNormalizedBbox(node) }));
        const boxes = measured.map((entry) => entry.bbox).filter(Boolean);
        const itemBoxes = items.map(nodeNormalizedBbox).filter(Boolean);
        const top = boxes.length
            ? clamp(Math.min(...boxes.map((bbox) => bbox[1])) - 0.015, 0.045, heading ? 0.13 : 0.08)
            : 0.07;
        const bottom = 0.87;
        const minimumLeft = itemBoxes.length ? Math.min(...itemBoxes.map((bbox) => bbox[0])) : null;
        const indentByNodeId = new Map();
        const indentSourceByNodeId = new Map();
        const tocLevelByNodeId = new Map();
        const decisionByNodeId = new Map();
        for (const item of items) {
            const decision = tocIndentDecision(item, minimumLeft);
            indentByNodeId.set(item.node_id, decision.indentPercent);
            indentSourceByNodeId.set(item.node_id, decision.source);
            if (decision.tocLevel !== null) tocLevelByNodeId.set(item.node_id, decision.tocLevel);
            decisionByNodeId.set(item.node_id, decision);
        }
        return {
            top,
            bottom,
            indentByNodeId,
            indentSourceByNodeId,
            tocLevelByNodeId,
            decisionByNodeId,
        };
    }

    function isNormalizedTocPage(page, previousPageWasToc = false) {
        if (page?.page_kind === 'cover') return false;
        const { heading, items } = tocParts(page);
        if (!items.length) return false;
        if (heading) return true;
        if (previousPageWasToc) return true;
        return items.length >= TOC_START_ITEM_THRESHOLD;
    }

    function addClass(element, className) {
        if (!element) return;
        if (element.classList?.add) {
            element.classList.add(className);
            return;
        }
        const classes = new Set(String(element.className || '').split(/\s+/).filter(Boolean));
        classes.add(className);
        element.className = [...classes].join(' ');
    }

    function applyImportantPaddingLeft(rendered, indentPercent) {
        const value = `${indentPercent}%`;
        rendered.dataset.readerTocIndent = String(indentPercent);
        if (typeof rendered.style?.setProperty === 'function') {
            rendered.style.setProperty('padding-left', value, 'important');
            rendered.style.setProperty('box-sizing', 'border-box', 'important');
            return;
        }
        rendered.style.paddingLeft = value;
        rendered.style.boxSizing = 'border-box';
    }

    function jsonSafeValue(value) {
        const seen = new WeakSet();
        return JSON.stringify(value, (key, current) => {
            if (typeof current === 'bigint') return String(current);
            if (current && typeof current === 'object') {
                if (seen.has(current)) return '[Circular]';
                seen.add(current);
            }
            return current;
        }, 2);
    }

    function tocDebugPayload(page, layout = tocLayout(page)) {
        const { heading, items, lists, listNodeIds } = tocParts(page);
        const itemIds = new Set(items.map((node) => node.node_id));
        const extras = (page?.nodes || []).filter((node) => (
            node !== heading && !itemIds.has(node.node_id) && !listNodeIds.has(node.node_id)
        ));
        return {
            diagnostic_version: 'reader_toc_structure_debug_v2',
            page: {
                presentation_id: page?.presentation_id ?? null,
                kind: page?.kind ?? null,
                page_kind: page?.page_kind ?? null,
                presentation_mode: page?.presentation_mode ?? null,
                source_unit_id: page?.source_unit_id ?? null,
                source_order: page?.source_order ?? null,
                source_unit: page?.source_unit ?? null,
                element_count: Array.isArray(page?.elements) ? page.elements.length : 0,
                node_count: Array.isArray(page?.nodes) ? page.nodes.length : 0,
            },
            derived_layout: {
                top: layout.top,
                bottom: layout.bottom,
                indent_by_node_id: Object.fromEntries(layout.indentByNodeId || []),
                indent_source_by_node_id: Object.fromEntries(layout.indentSourceByNodeId || []),
                toc_level_by_node_id: Object.fromEntries(layout.tocLevelByNodeId || []),
            },
            heading: heading ? {
                raw_node: heading,
                frontend_bbox: nodeNormalizedBbox(heading),
            } : null,
            structural_lists: lists.map((node) => ({
                raw_node: node,
                frontend_bbox: nodeNormalizedBbox(node),
            })),
            toc_items: items.map((node, index) => {
                const decision = layout.decisionByNodeId?.get(node.node_id)
                    || tocIndentDecision(node, null);
                return {
                    index,
                    raw_node: node,
                    frontend_bbox: nodeNormalizedBbox(node),
                    metadata_toc_level: tocLevelFromMetadata(node),
                    metadata_toc_level_source: node?.metadata?.toc_level_source ?? null,
                    normalized_text_for_legacy_fallback: normalizedTocItemText(node),
                    current_text_fallback_indent_percent: decision.legacyTextIndentPercent,
                    legacy_text_fallback_matched: decision.legacyTextMatched,
                    coordinate_fallback_indent_percent: decision.coordinateIndentPercent,
                    final_frontend_indent_percent: decision.indentPercent,
                    final_frontend_indent_source: decision.source,
                };
            }),
            extra_nodes_on_toc_page: extras.map((node) => ({
                raw_node: node,
                frontend_bbox: nodeNormalizedBbox(node),
            })),
        };
    }

    function renderTocDebugPanel(documentObject, page, layout) {
        const details = documentObject.createElement('details');
        details.className = 'reader-v2-toc-structure-debug';
        details.open = true;
        details.style.boxSizing = 'border-box';
        details.style.width = '100%';
        details.style.margin = '12px 0 0';
        details.style.padding = '10px 12px';
        details.style.border = '1px solid #9ca3af';
        details.style.borderRadius = '8px';
        details.style.background = '#f8fafc';
        details.style.color = '#111827';

        const summary = documentObject.createElement('summary');
        summary.textContent = 'TOC 完整结构数据（临时调试）';
        summary.style.cursor = 'pointer';
        summary.style.fontWeight = '700';
        details.appendChild(summary);

        const pre = documentObject.createElement('pre');
        pre.className = 'reader-v2-toc-structure-debug-json';
        pre.dataset.readerTocDebug = 'true';
        pre.textContent = jsonSafeValue(tocDebugPayload(page, layout));
        pre.style.maxHeight = '70vh';
        pre.style.overflow = 'auto';
        pre.style.margin = '10px 0 0';
        pre.style.padding = '10px';
        pre.style.borderRadius = '6px';
        pre.style.background = '#111827';
        pre.style.color = '#e5e7eb';
        pre.style.font = '12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.wordBreak = 'break-word';
        details.appendChild(pre);
        return details;
    }

    function renderNormalizedTocPage(controller, page) {
        const documentObject = controller.document;
        const { heading, items, listNodeIds } = tocParts(page);
        const layout = tocLayout(page);
        const section = documentObject.createElement('section');
        section.className = 'reader-v2-page reader-v2-page-semantic_full_page reader-v2-page--normalized-toc';
        section.dataset.presentationId = page.presentation_id;
        section.dataset.sourceUnitId = page.source_unit_id || '';

        const label = documentObject.createElement('div');
        label.className = 'reader-v2-page-label';
        label.textContent = `第 ${Number(page.source_order) + 1} 页`;
        section.appendChild(label);

        const shell = documentObject.createElement('div');
        shell.className = 'reader-v2-semantic-page-shell reader-v2-semantic-page-shell--toc';
        shell.style.aspectRatio = String(semanticPageDependency().pageAspectRatio(page.source_unit));
        section.appendChild(shell);

        const flow = documentObject.createElement('div');
        flow.className = 'reader-v2-semantic-page-toc';
        flow.style.top = `${layout.top * 100}%`;
        flow.style.bottom = `${(1 - layout.bottom) * 100}%`;
        if (!heading) addClass(flow, 'reader-v2-semantic-page-toc--continuation');
        shell.appendChild(flow);

        if (heading) {
            const renderedHeading = controller.renderNode(heading);
            addClass(renderedHeading, 'reader-v2-semantic-page-toc-heading');
            flow.appendChild(renderedHeading);
        }

        const itemIds = new Set(items.map((node) => node.node_id));
        for (const item of items) {
            const rendered = controller.renderNode(tocDisplayNode(item));
            addClass(rendered, 'reader-v2-semantic-page-toc-item');
            rendered.dataset.readerNodeId = item.node_id;
            rendered.dataset.readerOriginalNodeType = item.node_type || '';
            const indentPercent = layout.indentByNodeId.get(item.node_id) || 0;
            applyImportantPaddingLeft(rendered, indentPercent);
            rendered.dataset.readerTocIndentSource = layout.indentSourceByNodeId.get(item.node_id) || 'default';
            const tocLevel = layout.tocLevelByNodeId.get(item.node_id);
            if (tocLevel !== undefined) rendered.dataset.readerTocLevel = String(tocLevel);
            flow.appendChild(rendered);
        }

        for (const node of page.nodes || []) {
            if (node === heading || itemIds.has(node.node_id) || listNodeIds.has(node.node_id)) continue;
            const rendered = controller.renderNode(node);
            addClass(rendered, 'reader-v2-semantic-page-toc-extra');
            flow.appendChild(rendered);
        }
        section.appendChild(renderTocDebugPanel(documentObject, page, layout));
        return section;
    }

    function installSemanticPageIntegration() {
        const deps = resolveDeps();
        const prototype = deps.ReaderUI.ReaderV2Controller.prototype;
        if (prototype.__semanticPageIntegrationInstalled) return prototype;

        const legacyRenderPages = prototype.renderPages;
        prototype.renderPages = function renderPagesWithSemanticFullPage() {
            const pages = this.presentationState?.pages || [];
            if (!pages.some((page) => isSemanticFullPage(page, this.presentationState))) {
                return legacyRenderPages.call(this);
            }

            const container = this.element('readerV2Pages');
            if (!container) return;
            this.clear(container);

            let previousPageWasToc = false;
            for (const page of pages) {
                if (!isSemanticFullPage(page, this.presentationState)) {
                    previousPageWasToc = false;
                    const section = this.document.createElement('section');
                    section.className = `reader-v2-page reader-v2-page-${page.kind}`;
                    section.dataset.presentationId = page.presentation_id;
                    for (const node of page.nodes || []) section.appendChild(this.renderNode(node));
                    container.appendChild(section);
                    continue;
                }

                const tocPage = isNormalizedTocPage(page, previousPageWasToc);
                if (tocPage) {
                    container.appendChild(renderNormalizedTocPage(this, page));
                    previousPageWasToc = true;
                    continue;
                }
                previousPageWasToc = false;

                const renderPage = coverPageForSemanticPage(page);
                const section = deps.SemanticPage.renderSemanticPage({
                    documentObject: this.document,
                    page: renderPage,
                    renderNode: (node) => this.renderNode(node),
                    pageNumberLabel: `第 ${Number(page.source_order) + 1} 页`,
                });
                container.appendChild(section);
            }

            if (!pages.length) {
                const empty = this.document.createElement('p');
                empty.className = 'reader-v2-empty';
                empty.textContent = '当前文档没有可显示的语义内容。';
                container.appendChild(empty);
            }
        };

        Object.defineProperty(prototype, '__semanticPageIntegrationInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return prototype;
    }

    return {
        SEMANTIC_FULL_PAGE_MODE,
        TOC_START_ITEM_THRESHOLD,
        applyImportantPaddingLeft,
        coverPageForSemanticPage,
        installSemanticPageIntegration,
        isNormalizedTocPage,
        isSemanticFullPage,
        jsonSafeValue,
        nodeNormalizedBbox,
        normalizedTocItemText,
        renderNormalizedTocPage,
        renderTocDebugPanel,
        tocCoordinateIndentPercent,
        tocDebugPayload,
        tocDisplayNode,
        tocIndentDecision,
        tocLayout,
        tocLevelFromMetadata,
        tocLevelIndentPercent,
        tocParts,
        tocTextIndentDecision,
        tocTextIndentPercent,
    };
});