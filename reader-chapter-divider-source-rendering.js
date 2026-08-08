(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        // Keep the historical global/file name for loader compatibility. The module now
        // handles every explicit non-cover full-page source-rendering presentation role.
        root.ReaderChapterDividerSourceRenderingV2 = api;
        if (root.document) api.scheduleInstall(root);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const FULL_PAGE_SOURCE_KINDS = new Set([
        'title_page',
        'back_cover',
        'chapter_divider',
        'full_page_figure',
        'full_page_chart',
    ]);
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

    function isFullPageSourceRenderingNode(node) {
        const metadata = node?.metadata || {};
        return FULL_PAGE_SOURCE_KINDS.has(normalizedPageKind(node))
            && metadata.presentation_mode === PRESENTATION_MODE
            && Boolean(String(metadata.source_rendering_asset_id || '').trim());
    }

    // Backward-compatible alias retained for existing tests/callers from the first Preview cut.
    function isChapterDividerSourceRenderingNode(node) {
        return normalizedPageKind(node) === 'chapter_divider'
            && isFullPageSourceRenderingNode(node);
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

    function sourceRenderingCarrier(page, documentNodes = []) {
        const direct = (page?.nodes || []).find(isFullPageSourceRenderingNode);
        if (direct) return direct;
        const sourceUnitId = pageSourceUnitId(page);
        if (!sourceUnitId) return null;
        return (documentNodes || []).find((node) => (
            isFullPageSourceRenderingNode(node)
            && nodeSourceUnitIds(node).has(sourceUnitId)
        )) || null;
    }

    function chapterDividerCarrier(page, documentNodes = []) {
        const carrier = sourceRenderingCarrier(page, documentNodes);
        return carrier && normalizedPageKind(carrier) === 'chapter_divider' ? carrier : null;
    }

    function sourceRenderingCompatibilityPage(page, carrier) {
        if (!page || !carrier || !isFullPageSourceRenderingNode(carrier)) return page;
        const pageKind = normalizedPageKind(carrier);
        const assetId = String(carrier.metadata.source_rendering_asset_id).trim();
        const compatibilityCarrier = {
            ...carrier,
            metadata: {
                ...(carrier.metadata || {}),
                presentation_actual_page_kind: pageKind,
                // Reuse the production Cover renderer without changing canonical metadata.
                page_kind: 'cover',
                presentation_mode: PRESENTATION_MODE,
            },
            asset_refs: [assetId],
        };
        return {
            ...page,
            page_kind: 'cover',
            presentation_actual_page_kind: pageKind,
            presentation_mode: PRESENTATION_MODE,
            nodes: [compatibilityCarrier],
            // Let the existing Cover integration derive exactly one [0,0,1,1] source asset.
            elements: [],
        };
    }

    function chapterDividerCompatibilityPage(page, carrier) {
        if (!carrier || normalizedPageKind(carrier) !== 'chapter_divider') return page;
        return sourceRenderingCompatibilityPage(page, carrier);
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

    function decorateRenderedPage(controller, page, pageKind = null) {
        const container = controller?.element?.('readerV2Pages');
        const presentationId = String(page?.presentation_id || '');
        const resolvedKind = String(pageKind || page?.presentation_actual_page_kind || '').trim().toLowerCase();
        if (!container || !presentationId || !FULL_PAGE_SOURCE_KINDS.has(resolvedKind)) return;
        const children = Array.from(container.children || []);
        const section = children.find((child) => (
            String(child?.dataset?.presentationId || '') === presentationId
        ));
        if (!section) return;
        addClass(section, 'reader-v2-page--presentation-source-rendering');
        addClass(section, `reader-v2-page--${resolvedKind}-source-rendering`);
        section.dataset.pageKind = resolvedKind;
        section.dataset.presentationActualPageKind = resolvedKind;
    }

    function install(rootObject) {
        const readerUi = rootObject?.ReaderUIV2;
        const integration = rootObject?.ReaderSemanticPageIntegrationV2;
        const prototype = readerUi?.ReaderV2Controller?.prototype;
        if (!prototype || !integration?.installSemanticPageIntegration) return false;

        integration.installSemanticPageIntegration();
        if (prototype.__presentationSourceFullPageInstalled) return true;

        const legacyRenderPages = prototype.renderPages;
        if (typeof legacyRenderPages !== 'function') return false;

        prototype.renderPages = function renderPagesWithFullPagePresentationSources() {
            const originalState = this.presentationState;
            const originalPages = originalState?.pages || [];
            const transformed = [];
            const decorated = [];
            let changed = false;

            for (const page of originalPages) {
                const carrier = sourceRenderingCarrier(page, this.nodes || []);
                if (!carrier) {
                    transformed.push(page);
                    continue;
                }
                const pageKind = normalizedPageKind(carrier);
                transformed.push(sourceRenderingCompatibilityPage(page, carrier));
                decorated.push({ page, pageKind });
                changed = true;
            }

            if (!changed) return legacyRenderPages.call(this);

            this.presentationState = { ...originalState, pages: transformed };
            try {
                const result = legacyRenderPages.call(this);
                for (const item of decorated) decorateRenderedPage(this, item.page, item.pageKind);
                return result;
            } finally {
                this.presentationState = originalState;
            }
        };

        Object.defineProperty(prototype, '__presentationSourceFullPageInstalled', {
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
        FULL_PAGE_SOURCE_KINDS,
        INSTALL_RETRY_MS,
        INSTALL_TIMEOUT_MS,
        PRESENTATION_MODE,
        chapterDividerCarrier,
        chapterDividerCompatibilityPage,
        decorateRenderedPage,
        install,
        isChapterDividerSourceRenderingNode,
        isFullPageSourceRenderingNode,
        nodeSourceUnitIds,
        normalizedPageKind,
        pageSourceUnitId,
        scheduleInstall,
        sourceRenderingCarrier,
        sourceRenderingCompatibilityPage,
    };
});
