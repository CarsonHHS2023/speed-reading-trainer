(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.ReaderChapterDividerSourceRenderingV2 = api;
        if (root.document) api.scheduleInstall(root);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const PAGE_KIND = 'chapter_divider';
    const PRESENTATION_MODE = 'source_rendering';
    const INSTALL_RETRY_MS = 25;
    const INSTALL_TIMEOUT_MS = 10000;

    function normalizedPageKind(node) {
        return String(
            node?.metadata?.presentation_actual_page_kind
            || node?.metadata?.page_kind
            || node?.metadata?.page_classification?.page_role
            || '',
        ).trim().toLowerCase();
    }

    function isChapterDividerSourceRenderingNode(node) {
        const metadata = node?.metadata || {};
        return normalizedPageKind(node) === PAGE_KIND
            && metadata.presentation_mode === PRESENTATION_MODE
            && Boolean(String(metadata.source_rendering_asset_id || '').trim());
    }

    function nodeSourceUnitIds(node) {
        const ids = new Set();
        const add = (value) => {
            if (typeof value === 'string' && value.trim()) ids.add(value.trim());
        };
        add(node?.location?.source_unit_id);
        for (const value of node?.source_unit_ids || []) add(value);
        add(node?.location?.source_anchor?.source_unit_id);
        for (const anchor of node?.source_anchors || []) add(anchor?.source_unit_id);
        for (const fragment of node?.metadata?.page_fragments || []) {
            add(fragment?.source_unit_id);
            add(fragment?.source_anchor?.source_unit_id);
        }
        return ids;
    }

    function pageSourceUnitId(page) {
        const value = page?.source_unit_id || page?.source_unit?.source_unit_id;
        return typeof value === 'string' && value.trim() ? value.trim() : null;
    }

    function chapterDividerCarrier(page, documentNodes = []) {
        const direct = (page?.nodes || []).find(isChapterDividerSourceRenderingNode);
        if (direct) return direct;
        const sourceUnitId = pageSourceUnitId(page);
        if (!sourceUnitId) return null;
        return (documentNodes || []).find((node) => (
            isChapterDividerSourceRenderingNode(node)
            && nodeSourceUnitIds(node).has(sourceUnitId)
        )) || null;
    }

    function chapterDividerCompatibilityPage(page, carrier) {
        if (!page || !carrier || !isChapterDividerSourceRenderingNode(carrier)) return page;
        const assetId = String(carrier.metadata.source_rendering_asset_id).trim();
        const compatibilityCarrier = {
            ...carrier,
            metadata: {
                ...(carrier.metadata || {}),
                presentation_actual_page_kind: PAGE_KIND,
                page_kind: 'cover',
                presentation_mode: PRESENTATION_MODE,
            },
            asset_refs: [assetId],
        };
        return {
            ...page,
            page_kind: 'cover',
            presentation_actual_page_kind: PAGE_KIND,
            presentation_mode: PRESENTATION_MODE,
            nodes: [compatibilityCarrier],
            elements: [],
        };
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

    function decorateRenderedPage(controller, page) {
        const container = controller?.element?.('readerV2Pages');
        const presentationId = String(page?.presentation_id || '');
        if (!container || !presentationId) return;
        const children = Array.from(container.children || []);
        const section = children.find((child) => (
            String(child?.dataset?.presentationId || '') === presentationId
        ));
        if (!section) return;
        addClass(section, 'reader-v2-page--chapter-divider-source-rendering');
        section.dataset.pageKind = PAGE_KIND;
        section.dataset.presentationActualPageKind = PAGE_KIND;
    }

    function install(rootObject) {
        const readerUi = rootObject?.ReaderUIV2;
        const integration = rootObject?.ReaderSemanticPageIntegrationV2;
        const prototype = readerUi?.ReaderV2Controller?.prototype;
        if (!prototype || !integration?.installSemanticPageIntegration) return false;

        integration.installSemanticPageIntegration();
        if (prototype.__chapterDividerSourceRenderingInstalled) return true;

        const legacyRenderPages = prototype.renderPages;
        if (typeof legacyRenderPages !== 'function') return false;

        prototype.renderPages = function renderPagesWithFullPageChapterDivider() {
            const originalState = this.presentationState;
            const originalPages = originalState?.pages || [];
            const transformed = [];
            const decorated = [];
            let changed = false;

            for (const page of originalPages) {
                const carrier = chapterDividerCarrier(page, this.nodes || []);
                if (!carrier) {
                    transformed.push(page);
                    continue;
                }
                transformed.push(chapterDividerCompatibilityPage(page, carrier));
                decorated.push(page);
                changed = true;
            }

            if (!changed) return legacyRenderPages.call(this);

            this.presentationState = { ...originalState, pages: transformed };
            try {
                const result = legacyRenderPages.call(this);
                for (const page of decorated) decorateRenderedPage(this, page);
                return result;
            } finally {
                this.presentationState = originalState;
            }
        };

        Object.defineProperty(prototype, '__chapterDividerSourceRenderingInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function scheduleInstall(rootObject) {
        const started = Date.now();
        function attempt() {
            if (install(rootObject)) return true;
            if (Date.now() - started >= INSTALL_TIMEOUT_MS) return false;
            rootObject?.setTimeout?.(attempt, INSTALL_RETRY_MS);
            return false;
        }
        return attempt();
    }

    return {
        INSTALL_RETRY_MS,
        INSTALL_TIMEOUT_MS,
        PAGE_KIND,
        PRESENTATION_MODE,
        chapterDividerCarrier,
        chapterDividerCompatibilityPage,
        decorateRenderedPage,
        install,
        isChapterDividerSourceRenderingNode,
        nodeSourceUnitIds,
        normalizedPageKind,
        pageSourceUnitId,
        scheduleInstall,
    };
});
