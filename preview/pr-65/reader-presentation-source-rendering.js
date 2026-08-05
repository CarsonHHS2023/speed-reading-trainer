(function (root, factory) {
    const api = factory(
        root && root.ReaderUIV2,
        root && root.ReaderSemanticPageIntegrationV2,
        root && root.SpeedReadingAdapter,
    );
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.ReaderPresentationSourceRenderingV2 = api;
        if (root.document && typeof root.setTimeout === 'function') {
            root.setTimeout(() => api.install(root), 0);
        }
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ReaderUI, SemanticIntegration, SpeedAdapter) {
    'use strict';

    const PRESENTATION_ROLES = new Set([
        'cover',
        'back_cover',
        'title_page',
        'chapter_divider',
        'full_page_figure',
        'full_page_chart',
    ]);
    const SEMANTIC_FULL_PAGE_MODE = 'semantic_full_page';

    function resolveDeps(rootObject) {
        if (typeof require === 'function') {
            ReaderUI = ReaderUI || require('./reader-ui-v2.js');
            SemanticIntegration = SemanticIntegration || require('./reader-semantic-page-integration.js');
            SpeedAdapter = SpeedAdapter || require('./speed-reading-adapter.js');
        }
        ReaderUI = ReaderUI || rootObject?.ReaderUIV2;
        SemanticIntegration = SemanticIntegration || rootObject?.ReaderSemanticPageIntegrationV2;
        SpeedAdapter = SpeedAdapter || rootObject?.SpeedReadingAdapter;
        return { ReaderUI, SemanticIntegration, SpeedAdapter };
    }

    function normalizedPageKind(node) {
        return String(
            node?.metadata?.presentation_actual_page_kind
            || node?.metadata?.page_kind
            || node?.metadata?.page_classification?.page_role
            || '',
        ).trim().toLowerCase();
    }

    function isPresentationSourceRenderingNode(node) {
        const metadata = node?.metadata || {};
        const pageKind = normalizedPageKind(node);
        return PRESENTATION_ROLES.has(pageKind)
            && metadata.presentation_mode === 'source_rendering'
            && metadata.ocr_route === 'skipped_presentation_image'
            && Boolean(String(metadata.source_rendering_asset_id || '').trim());
    }

    function presentationCarrier(page) {
        return (page?.nodes || []).find(isPresentationSourceRenderingNode) || null;
    }

    function classificationAudit(node) {
        if (!isPresentationSourceRenderingNode(node)) return null;
        const metadata = node.metadata || {};
        const classification = metadata.page_classification || {};
        const preprocessing = metadata.opencv_page_preprocessing || {};
        const geometry = metadata.geometry || preprocessing.geometry || {};
        const background = metadata.background || preprocessing.background || {};
        return {
            page_kind: normalizedPageKind(node),
            confidence: Number.isFinite(Number(classification.confidence))
                ? Number(classification.confidence)
                : null,
            reason_codes: Array.isArray(classification.reason_codes)
                ? [...classification.reason_codes]
                : [],
            ocr_route: metadata.ocr_route || null,
            geometry_route: preprocessing.route || metadata.source_pdf_kind || null,
            geometry_selected: preprocessing.selected || null,
            geometry_accepted: typeof geometry.accepted === 'boolean' ? geometry.accepted : null,
            background_attempted: typeof background.attempted === 'boolean'
                ? background.attempted
                : null,
            background_reason: background.reason || null,
            source_rendering_asset_id: String(metadata.source_rendering_asset_id || ''),
        };
    }

    function semanticCompatibilityPage(page) {
        const carrier = presentationCarrier(page);
        if (!carrier) return page;
        const pageKind = normalizedPageKind(carrier);
        const assetId = String(carrier.metadata.source_rendering_asset_id).trim();
        const compatibilityCarrier = {
            ...carrier,
            metadata: {
                ...(carrier.metadata || {}),
                presentation_actual_page_kind: pageKind,
                page_kind: 'cover',
            },
            asset_refs: [assetId],
        };
        return {
            ...page,
            kind: SEMANTIC_FULL_PAGE_MODE,
            nodes: [compatibilityCarrier],
            presentation_actual_page_kind: pageKind,
            presentation_mode: 'source_rendering',
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

    function childElements(container) {
        if (!container) return [];
        if (Array.isArray(container.children)) return container.children;
        return Array.from(container.children || []);
    }

    function sectionForPresentation(container, presentationId) {
        return childElements(container).find((child) => (
            String(child?.dataset?.presentationId || '') === String(presentationId || '')
        )) || null;
    }

    function auditDebugPanel(documentObject, audit) {
        if (!documentObject?.createElement || !audit) return null;
        const details = documentObject.createElement('details');
        details.className = 'reader-v2-presentation-audit';
        details.dataset.readerPresentationAudit = 'true';

        const summary = documentObject.createElement('summary');
        summary.textContent = `页面分类：${audit.page_kind || 'unknown'}`;
        details.appendChild(summary);

        const pre = documentObject.createElement('pre');
        pre.className = 'reader-v2-presentation-audit-json';
        pre.textContent = JSON.stringify(audit, null, 2);
        details.appendChild(pre);
        return details;
    }

    function decorateRenderedPresentationPages(controller, auditByPresentationId) {
        const container = controller?.element?.('readerV2Pages');
        if (!container) return;
        for (const [presentationId, audit] of auditByPresentationId.entries()) {
            const section = sectionForPresentation(container, presentationId);
            if (!section) continue;
            addClass(section, 'reader-v2-page--presentation-source-rendering');
            section.dataset.pageKind = audit.page_kind || '';
            section.dataset.ocrRoute = audit.ocr_route || '';
            section.dataset.geometryRoute = audit.geometry_route || '';
            section.dataset.backgroundAttempted = String(audit.background_attempted);
            section.dataset.classificationConfidence = audit.confidence == null
                ? ''
                : String(audit.confidence);
            section.dataset.classificationReasonCodes = audit.reason_codes.join(',');
            if (!childElements(section).some((child) => child?.dataset?.readerPresentationAudit === 'true')) {
                const panel = auditDebugPanel(controller.document, audit);
                if (panel) section.appendChild(panel);
            }
        }
    }

    function installReaderRenderingPatch(readerUi, semanticIntegration) {
        const prototype = readerUi?.ReaderV2Controller?.prototype;
        if (!prototype) return false;
        semanticIntegration?.installSemanticPageIntegration?.();
        if (prototype.__presentationSourceRenderingInstalled) return true;

        const legacyRenderPages = prototype.renderPages;
        prototype.renderPages = function renderPagesWithPresentationSourceRendering() {
            const originalState = this.presentationState || { mode: 'reflow', pages: [] };
            const auditByPresentationId = new Map();
            const pages = (originalState.pages || []).map((page) => {
                const carrier = presentationCarrier(page);
                if (!carrier) return page;
                auditByPresentationId.set(page.presentation_id, classificationAudit(carrier));
                return semanticCompatibilityPage(page);
            });
            if (!auditByPresentationId.size) return legacyRenderPages.call(this);

            this.presentationState = { ...originalState, pages };
            try {
                const result = legacyRenderPages.call(this);
                decorateRenderedPresentationPages(this, auditByPresentationId);
                return result;
            } finally {
                this.presentationState = originalState;
            }
        };
        Object.defineProperty(prototype, '__presentationSourceRenderingInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function nodeSourceUnitIds(node) {
        const ids = new Set();
        const addId = (value) => {
            if (typeof value === 'string' && value.trim()) ids.add(value.trim());
        };
        addId(node?.location?.source_unit_id);
        for (const value of node?.source_unit_ids || []) addId(value);
        for (const anchor of node?.source_anchors || []) addId(anchor?.source_unit_id);
        addId(node?.location?.source_anchor?.source_unit_id);
        const pageFragments = Array.isArray(node?.metadata?.page_fragments)
            ? node.metadata.page_fragments
            : [];
        for (const fragment of pageFragments) {
            addId(fragment?.source_unit_id);
            addId(fragment?.source_anchor?.source_unit_id);
        }
        return ids;
    }

    function presentationSourceUnitIds(nodes) {
        const ids = new Set();
        for (const node of nodes || []) {
            if (!isPresentationSourceRenderingNode(node)) continue;
            for (const sourceUnitId of nodeSourceUnitIds(node)) ids.add(sourceUnitId);
        }
        return ids;
    }

    function filteredPlaybackNodes(nodes) {
        const values = nodes || [];
        const presentationUnits = presentationSourceUnitIds(values);
        return values.filter((node) => {
            if (isPresentationSourceRenderingNode(node)) return false;
            if (!presentationUnits.size) return true;
            for (const sourceUnitId of nodeSourceUnitIds(node)) {
                if (presentationUnits.has(sourceUnitId)) return false;
            }
            return true;
        });
    }

    function installSpeedReadingPatch(adapter) {
        if (!adapter || adapter.__presentationSourceRenderingInstalled) return Boolean(adapter);
        const legacyBuildPlaybackFrames = adapter.buildPlaybackFrames;
        const legacyBuildReadingElements = adapter.buildReadingElements;
        if (typeof legacyBuildPlaybackFrames !== 'function' || typeof legacyBuildReadingElements !== 'function') {
            return false;
        }
        adapter.buildPlaybackFrames = function buildPlaybackFramesWithoutPresentationPages(documentView, nodes, options) {
            return legacyBuildPlaybackFrames.call(this, documentView, filteredPlaybackNodes(nodes), options);
        };
        adapter.buildReadingElements = function buildReadingElementsWithoutPresentationPages(documentView, nodes) {
            return legacyBuildReadingElements.call(this, documentView, filteredPlaybackNodes(nodes));
        };
        Object.defineProperty(adapter, '__presentationSourceRenderingInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function install(rootObject) {
        const deps = resolveDeps(rootObject);
        const readerInstalled = installReaderRenderingPatch(
            deps.ReaderUI,
            deps.SemanticIntegration,
        );
        const speedInstalled = installSpeedReadingPatch(deps.SpeedAdapter);
        return { readerInstalled, speedInstalled };
    }

    return {
        PRESENTATION_ROLES,
        SEMANTIC_FULL_PAGE_MODE,
        auditDebugPanel,
        classificationAudit,
        decorateRenderedPresentationPages,
        filteredPlaybackNodes,
        install,
        installReaderRenderingPatch,
        installSpeedReadingPatch,
        isPresentationSourceRenderingNode,
        nodeSourceUnitIds,
        normalizedPageKind,
        presentationCarrier,
        presentationSourceUnitIds,
        semanticCompatibilityPage,
    };
});
