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

    function currentSourceUnitId(controller) {
        const frame = controller?.playback?.snapshot?.()?.frame;
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
        const toolbar = documentObject?.getElementById?.('speedReadingV2Toolbar');
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
        return true;
    }

    return { BUTTON_ID, buildDebugUrl, currentSourceUnitId, ensureButton, install };
});
