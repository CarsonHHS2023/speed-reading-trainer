(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.ReaderDebugToolbarV2 = api;
        if (root.document) api.install({ root });
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const BUTTON_ID = 'speedReadingDebug';
    const ACTIVE_PLAYBACK_STATES = new Set(['playing', 'paused', 'manual']);
    const TOP_TOOLBAR_ID = 'speedReadingV2Toolbar';
    const READING_TOGGLE_ID = 'readingToggleBtn';
    const BOOKLIST_CONTROLS_CLASS = 'reader-booklist-playback-controls';
    const RAIL_SELECTOR = '#readerStudyToolsRail';
    const RAIL_TABS_SELECTOR = '.reader-study-tools-tabs';
    const ZOOM_INDICATOR_SELECTOR = '.reader-page-zoom-indicator';
    const ZOOM_RESET_TITLE = '恢复到100%';
    const LAYOUT_RETRY_MS = 25;
    const LAYOUT_TIMEOUT_MS = 10000;
    const MOVED_PLAYBACK_CONTROL_IDS = Object.freeze([
        'speedReadingFirst',
        'speedReadingPrev',
        READING_TOGGLE_ID,
        'speedReadingNext',
        'speedReadingLast',
        'speedReadingStop',
    ]);

    function currentSourceUnitId(controller) {
        const snapshot = controller?.playback?.snapshot?.() || null;
        const frame = ACTIVE_PLAYBACK_STATES.has(snapshot?.state) ? snapshot?.frame : null;
        return frame?.identity?.source_unit_id
            || controller?.reader?.lastLocation?.source_unit_id
            || null;
    }

    function buildDebugUrl(controller, baseUrl = 'reader-node-debug.html') {
        const documentRef = controller?.reader?.documentRef;
        const candidateId = controller?.reader?.candidateId;
        if (!documentRef || !candidateId) return null;
        const params = new URLSearchParams();
        params.set('document_ref', String(documentRef));
        params.set('candidate_id', String(candidateId));
        const sourceUnitId = currentSourceUnitId(controller);
        if (sourceUnitId) params.set('source_unit_id', String(sourceUnitId));
        return `${baseUrl}?${params.toString()}`;
    }

    function ensureButton(root, controller) {
        const documentObject = root?.document;
        const toolbar = documentObject?.getElementById?.(TOP_TOOLBAR_ID);
        if (!toolbar) return null;
        let button = documentObject.getElementById(BUTTON_ID);
        if (!button) {
            button = documentObject.createElement('button');
            button.id = BUTTON_ID;
            button.type = 'button';
            button.textContent = '🐞';
            button.title = '打开当前页面节点调试';
            button.setAttribute?.('aria-label', button.title);
            button.addEventListener('click', () => {
                const href = buildDebugUrl(controller);
                if (href) root.open?.(href, '_blank', 'noopener');
            });
            toolbar.appendChild(button);
        }
        button.disabled = !buildDebugUrl(controller);
        return button;
    }

    function relocateReaderControls(root) {
        const documentObject = root?.document;
        const header = documentObject?.querySelector?.('.booklist-header');
        const rail = documentObject?.querySelector?.(RAIL_SELECTOR);
        const tabs = rail?.querySelector?.(RAIL_TABS_SELECTOR);
        const toolbar = documentObject?.getElementById?.(TOP_TOOLBAR_ID);
        const debugButton = documentObject?.getElementById?.(BUTTON_ID);
        const controls = MOVED_PLAYBACK_CONTROL_IDS.map((id) => documentObject?.getElementById?.(id));
        if (!header || !tabs || !toolbar || !debugButton || controls.some((control) => !control)) return false;
        if (toolbar.classList?.contains('speed-reading-v2-toolbar-compat')) return true;

        let group = header.querySelector?.(`.${BOOKLIST_CONTROLS_CLASS}`);
        if (!group) {
            group = documentObject.createElement('div');
            group.className = BOOKLIST_CONTROLS_CLASS;
            group.setAttribute?.('role', 'group');
            group.setAttribute?.('aria-label', '速度阅读控制');
            header.appendChild(group);
        }
        for (const control of controls) group.appendChild(control);

        debugButton.classList?.add('reader-study-tool-tab', 'reader-debug-tool-button');
        tabs.appendChild(debugButton);

        const compatibilityAnchor = documentObject.createElement('div');
        compatibilityAnchor.id = TOP_TOOLBAR_ID;
        compatibilityAnchor.className = 'speed-reading-v2-toolbar-compat';
        compatibilityAnchor.hidden = true;
        compatibilityAnchor.setAttribute?.('aria-hidden', 'true');
        if (typeof toolbar.replaceWith === 'function') toolbar.replaceWith(compatibilityAnchor);
        else toolbar.parentNode?.replaceChild?.(compatibilityAnchor, toolbar);
        return true;
    }

    function resetAllPagesTo100(root) {
        const documentObject = root?.document;
        const zoom = root?.ReaderPageZoomPanV2;
        if (!documentObject || !zoom?.applyState || !zoom?.initialState) return 0;
        const pages = documentObject.querySelectorAll?.('.reader-v2-page') || [];
        let count = 0;
        for (const page of pages) {
            zoom.applyState(page, zoom.initialState());
            count += 1;
        }
        zoom.updateZoomIndicator?.(documentObject, 1);
        return count;
    }

    function configureZoomResetIndicator(root) {
        const documentObject = root?.document;
        const rail = documentObject?.querySelector?.(RAIL_SELECTOR);
        const indicator = rail?.querySelector?.(ZOOM_INDICATOR_SELECTOR);
        if (!indicator) return false;
        indicator.title = ZOOM_RESET_TITLE;
        indicator.setAttribute?.('aria-label', ZOOM_RESET_TITLE);
        indicator.setAttribute?.('role', 'button');
        indicator.setAttribute?.('tabindex', '0');
        if (indicator.dataset?.readerZoomResetBound === '1') return true;
        if (indicator.dataset) indicator.dataset.readerZoomResetBound = '1';
        indicator.addEventListener?.('click', () => resetAllPagesTo100(root));
        indicator.addEventListener?.('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault?.();
            resetAllPagesTo100(root);
        });
        return true;
    }

    function scheduleLayout(root, controller) {
        const documentObject = root?.document;
        if (!documentObject || documentObject.__readerToolbarLayoutScheduled) return false;
        documentObject.__readerToolbarLayoutScheduled = true;
        const started = Date.now();
        const attempt = () => {
            ensureButton(root, controller);
            const controlsReady = relocateReaderControls(root);
            const zoomReady = configureZoomResetIndicator(root);
            if (controlsReady && zoomReady) return true;
            if (Date.now() - started >= LAYOUT_TIMEOUT_MS) return false;
            root?.setTimeout?.(attempt, LAYOUT_RETRY_MS);
            return false;
        };
        return attempt();
    }

    function install(options = {}) {
        const root = options.root || (typeof globalThis !== 'undefined' ? globalThis : null);
        const playbackUi = options.playbackUi || root?.ReaderSpeedPlaybackUI;
        const controller = options.controller || playbackUi?.getDefaultController?.();
        if (!root?.document || !controller) return false;
        const original = controller.updateControls?.bind(controller);
        if (original && !controller.__readerDebugToolbarPatched) {
            controller.updateControls = function updateControlsWithDebug(...args) {
                const result = original(...args);
                ensureButton(root, controller);
                return result;
            };
            controller.__readerDebugToolbarPatched = true;
        }
        ensureButton(root, controller);
        scheduleLayout(root, controller);
        return true;
    }

    return {
        ACTIVE_PLAYBACK_STATES,
        BOOKLIST_CONTROLS_CLASS,
        BUTTON_ID,
        LAYOUT_RETRY_MS,
        LAYOUT_TIMEOUT_MS,
        MOVED_PLAYBACK_CONTROL_IDS,
        RAIL_SELECTOR,
        READING_TOGGLE_ID,
        TOP_TOOLBAR_ID,
        ZOOM_INDICATOR_SELECTOR,
        ZOOM_RESET_TITLE,
        buildDebugUrl,
        configureZoomResetIndicator,
        currentSourceUnitId,
        ensureButton,
        install,
        relocateReaderControls,
        resetAllPagesTo100,
        scheduleLayout,
    };
});