(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.ReaderPageZoomPanV2 = api;
        if (root.document) api.scheduleInstall(root);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const MIN_SCALE = 1;
    const MAX_SCALE = 4;
    const WHEEL_SENSITIVITY = 0.0015;
    const INSTALL_RETRY_MS = 25;
    const INSTALL_TIMEOUT_MS = 10000;
    const PAGE_SELECTOR = '.reader-v2-page-semantic_full_page';
    const SHELL_SELECTOR = '.reader-v2-semantic-page-shell';
    const EPSILON = 1e-6;

    const stateByShell = new WeakMap();

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function clampScale(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return MIN_SCALE;
        return clamp(numeric, MIN_SCALE, MAX_SCALE);
    }

    function initialState() {
        return { scale: MIN_SCALE, x: 0, y: 0 };
    }

    function stateForShell(shell) {
        if (!shell) return initialState();
        let state = stateByShell.get(shell);
        if (!state) {
            state = initialState();
            stateByShell.set(shell, state);
        }
        return state;
    }

    function dimensionsFor(page, shell) {
        const pageRect = page?.getBoundingClientRect?.() || {};
        const shellRect = shell?.getBoundingClientRect?.() || {};
        const viewportWidth = Number(page?.clientWidth || pageRect.width || 0);
        const viewportHeight = Number(page?.clientHeight || pageRect.height || 0);
        const contentWidth = Number(shell?.offsetWidth || shell?.clientWidth || shellRect.width || viewportWidth || 0);
        const contentHeight = Number(shell?.offsetHeight || shell?.clientHeight || shellRect.height || viewportHeight || 0);
        return {
            viewportWidth: Math.max(0, viewportWidth),
            viewportHeight: Math.max(0, viewportHeight),
            contentWidth: Math.max(0, contentWidth),
            contentHeight: Math.max(0, contentHeight),
        };
    }

    function clampPan(state, dimensions) {
        const scale = clampScale(state?.scale);
        if (scale <= MIN_SCALE + EPSILON) return { scale: MIN_SCALE, x: 0, y: 0 };

        const viewportWidth = Math.max(0, Number(dimensions?.viewportWidth || 0));
        const viewportHeight = Math.max(0, Number(dimensions?.viewportHeight || 0));
        const contentWidth = Math.max(0, Number(dimensions?.contentWidth || viewportWidth));
        const contentHeight = Math.max(0, Number(dimensions?.contentHeight || viewportHeight));
        const minimumX = Math.min(0, viewportWidth - (contentWidth * scale));
        const minimumY = Math.min(0, viewportHeight - (contentHeight * scale));
        return {
            scale,
            x: clamp(Number(state?.x || 0), minimumX, 0),
            y: clamp(Number(state?.y || 0), minimumY, 0),
        };
    }

    function scaleFromWheelDelta(currentScale, deltaPixels) {
        const current = clampScale(currentScale);
        const delta = Number(deltaPixels);
        if (!Number.isFinite(delta) || delta === 0) return current;
        return clampScale(current * Math.exp(-delta * WHEEL_SENSITIVITY));
    }

    function zoomStateAtPoint(state, nextScale, point, dimensions) {
        const current = clampPan(state || initialState(), dimensions);
        const scale = clampScale(nextScale);
        if (scale <= MIN_SCALE + EPSILON) return initialState();
        if (Math.abs(scale - current.scale) <= EPSILON) return current;

        const pointX = Number(point?.x || 0);
        const pointY = Number(point?.y || 0);
        const contentX = (pointX - current.x) / current.scale;
        const contentY = (pointY - current.y) / current.scale;
        return clampPan({
            scale,
            x: pointX - (contentX * scale),
            y: pointY - (contentY * scale),
        }, dimensions);
    }

    function normalizeWheelDelta(event, viewportHeight) {
        let delta = Number(event?.deltaY || 0);
        if (!Number.isFinite(delta)) return 0;
        if (event?.deltaMode === 1) delta *= 16;
        else if (event?.deltaMode === 2) delta *= Math.max(1, Number(viewportHeight || 800));
        return delta;
    }

    function pageForTarget(target) {
        if (!target || typeof target.closest !== 'function') return null;
        return target.closest(PAGE_SELECTOR);
    }

    function shellForPage(page) {
        if (!page || typeof page.querySelector !== 'function') return null;
        return page.querySelector(SHELL_SELECTOR);
    }

    function addClass(element, className) {
        if (element?.classList?.add) element.classList.add(className);
    }

    function removeClass(element, className) {
        if (element?.classList?.remove) element.classList.remove(className);
    }

    function applyState(page, shell, nextState) {
        if (!page || !shell) return initialState();
        const state = {
            scale: clampScale(nextState?.scale),
            x: Number(nextState?.x || 0),
            y: Number(nextState?.y || 0),
        };
        if (state.scale <= MIN_SCALE + EPSILON) {
            state.scale = MIN_SCALE;
            state.x = 0;
            state.y = 0;
            shell.style.transform = '';
            shell.style.transformOrigin = '';
            delete page.dataset.readerZoomScale;
            removeClass(page, 'reader-v2-page--zoomed');
        } else {
            shell.style.transformOrigin = '0 0';
            shell.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`;
            page.dataset.readerZoomScale = state.scale.toFixed(3);
            addClass(page, 'reader-v2-page--zoomed');
        }
        stateByShell.set(shell, state);
        return state;
    }

    function install(rootObject) {
        const documentObject = rootObject?.document;
        const container = documentObject?.getElementById?.('readerV2Pages');
        if (!container?.addEventListener) return false;
        if (container.__readerPageZoomPanInstalled) return true;

        let drag = null;

        container.addEventListener('wheel', (event) => {
            const page = pageForTarget(event.target);
            const shell = shellForPage(page);
            if (!page || !shell) return;

            const dimensions = dimensionsFor(page, shell);
            const state = stateForShell(shell);
            const delta = normalizeWheelDelta(event, dimensions.viewportHeight);
            const nextScale = scaleFromWheelDelta(state.scale, delta);
            if (Math.abs(nextScale - state.scale) <= EPSILON) return;

            event.preventDefault();
            const rect = page.getBoundingClientRect();
            const point = {
                x: Number(event.clientX) - Number(rect.left || 0),
                y: Number(event.clientY) - Number(rect.top || 0),
            };
            applyState(page, shell, zoomStateAtPoint(state, nextScale, point, dimensions));
        }, { passive: false });

        container.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            const page = pageForTarget(event.target);
            const shell = shellForPage(page);
            if (!page || !shell) return;
            const state = clampPan(stateForShell(shell), dimensionsFor(page, shell));
            if (state.scale <= MIN_SCALE + EPSILON) return;

            event.preventDefault();
            drag = {
                pointerId: event.pointerId,
                page,
                shell,
                startClientX: Number(event.clientX),
                startClientY: Number(event.clientY),
                startX: state.x,
                startY: state.y,
                scale: state.scale,
            };
            addClass(page, 'reader-v2-page--zoom-dragging');
            try { shell.setPointerCapture?.(event.pointerId); } catch (_) { /* optional */ }
        });

        container.addEventListener('pointermove', (event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            event.preventDefault();
            const next = clampPan({
                scale: drag.scale,
                x: drag.startX + (Number(event.clientX) - drag.startClientX),
                y: drag.startY + (Number(event.clientY) - drag.startClientY),
            }, dimensionsFor(drag.page, drag.shell));
            applyState(drag.page, drag.shell, next);
        });

        function finishDrag(event) {
            if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
            const active = drag;
            drag = null;
            removeClass(active.page, 'reader-v2-page--zoom-dragging');
            try { active.shell.releasePointerCapture?.(active.pointerId); } catch (_) { /* optional */ }
        }

        container.addEventListener('pointerup', finishDrag);
        container.addEventListener('pointercancel', finishDrag);
        container.addEventListener('lostpointercapture', finishDrag);
        container.addEventListener('dragstart', (event) => {
            const page = pageForTarget(event.target);
            if (page?.classList?.contains('reader-v2-page--zoomed')) event.preventDefault();
        });

        Object.defineProperty(container, '__readerPageZoomPanInstalled', {
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
        MAX_SCALE,
        MIN_SCALE,
        PAGE_SELECTOR,
        SHELL_SELECTOR,
        WHEEL_SENSITIVITY,
        applyState,
        clamp,
        clampPan,
        clampScale,
        dimensionsFor,
        initialState,
        install,
        normalizeWheelDelta,
        pageForTarget,
        scaleFromWheelDelta,
        scheduleInstall,
        shellForPage,
        stateForShell,
        zoomStateAtPoint,
    };
});
