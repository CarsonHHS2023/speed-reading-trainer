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

    function isSemanticFullPage(page, presentationState) {
        const mode = presentationState?.mode;
        return mode === Presentation.PRESENTATION_MODE_SEMANTIC_FULL_PAGE
            || page?.kind === Presentation.PRESENTATION_MODE_SEMANTIC_FULL_PAGE
            || page?.kind === 'semantic_full_page';
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

                const section = deps.SemanticPage.renderSemanticPage({
                    documentObject: this.document,
                    page,
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
        installSemanticPageIntegration,
        isSemanticFullPage,
    };
});
