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

            for (const page of pages) {
                if (!isSemanticFullPage(page, this.presentationState)) {
                    const section = this.document.createElement('section');
                    section.className = `reader-v2-page reader-v2-page-${page.kind}`;
                    section.dataset.presentationId = page.presentation_id;
                    for (const node of page.nodes || []) section.appendChild(this.renderNode(node));
                    container.appendChild(section);
                    continue;
                }

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
        coverPageForSemanticPage,
        installSemanticPageIntegration,
        isSemanticFullPage,
    };
});