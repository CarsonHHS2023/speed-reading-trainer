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
        const listNodeIds = new Set(
            nodes
                .filter((node) => node?.metadata?.recovery_rule === TOC_LIST_RULE)
                .map((node) => node.node_id),
        );
        return { heading, items, listNodeIds };
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

    function tocLayout(page) {
        const { heading, items } = tocParts(page);
        const measured = [heading, ...items].filter(Boolean).map((node) => ({ node, bbox: nodeNormalizedBbox(node) }));
        const boxes = measured.map((entry) => entry.bbox).filter(Boolean);
        const itemBoxes = items.map(nodeNormalizedBbox).filter(Boolean);
        if (!boxes.length) {
            return { top: 0.07, bottom: 0.93, indentByNodeId: new Map() };
        }

        const sourceTop = Math.min(...boxes.map((bbox) => bbox[1]));
        const sourceBottom = Math.max(...boxes.map((bbox) => bbox[3]));
        const top = clamp(sourceTop - 0.015, 0.045, heading ? 0.13 : 0.08);
        const bottom = clamp(Math.max(sourceBottom + 0.02, 0.86), 0.86, 0.965);
        const minimumLeft = itemBoxes.length ? Math.min(...itemBoxes.map((bbox) => bbox[0])) : 0;
        const indentByNodeId = new Map();
        for (const item of items) {
            const bbox = nodeNormalizedBbox(item);
            const sourceIndent = bbox ? Math.max(0, bbox[0] - minimumLeft) : 0;
            indentByNodeId.set(item.node_id, clamp(sourceIndent * 100, 0, 12));
        }
        return { top, bottom, indentByNodeId };
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
            const rendered = controller.renderNode(item);
            addClass(rendered, 'reader-v2-semantic-page-toc-item');
            rendered.dataset.readerNodeId = item.node_id;
            rendered.style.marginLeft = `${layout.indentByNodeId.get(item.node_id) || 0}%`;
            flow.appendChild(rendered);
        }

        for (const node of page.nodes || []) {
            if (node === heading || itemIds.has(node.node_id) || listNodeIds.has(node.node_id)) continue;
            const rendered = controller.renderNode(node);
            addClass(rendered, 'reader-v2-semantic-page-toc-extra');
            flow.appendChild(rendered);
        }
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
        coverPageForSemanticPage,
        installSemanticPageIntegration,
        isNormalizedTocPage,
        isSemanticFullPage,
        nodeNormalizedBbox,
        renderNormalizedTocPage,
        tocLayout,
        tocParts,
    };
});