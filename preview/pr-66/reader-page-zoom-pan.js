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
    const PAGE_SELECTOR = '.reader-v2-page';
    const SEMANTIC_SHELL_SELECTOR = '.reader-v2-semantic-page-shell';
    const FALLBACK_SURFACE_SELECTOR = '.reader-v2-page-zoom-surface';
    const LABEL_SELECTOR = '.reader-v2-page-label';
    const BADGE_CLASS = 'reader-v2-page-zoom-badge';
    const EPSILON = 1e-6;

    const stateBySurface = new WeakMap();

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

    function stateForSurface(surface) {
        if (!surface) return initialState();
        let state = stateBySurface.get(surface);
        if (!state) {
            state = initialState();
            stateBySurface.set(surface, state);
        }
        return state;
    }

    // Backward-compatible alias retained for the first Preview test cut.
    function stateForShell(surface) {
        return stateForSurface(surface);
    }

    function dimensionsFor(page, surface) {
        const pageRect = page?.getBoundingClientRect?.() || {};
        const surfaceRect = surface?.getBoundingClientRect?.() || {};
        const baseWidth = Number(
            surface?.offsetWidth
            || surface?.clientWidth
            || surfaceRect.width
            || page?.clientWidth
            || pageRect.width
            || 0
        );
        const baseHeight = Number(
            surface?.offsetHeight
            || surface?.clientHeight
            || surfaceRect.height
            || page?.clientHeight
            || pageRect.height
            || 0
        );
        return {
            viewportWidth: Math.max(0, baseWidth),
            viewportHeight: Math.max(0, baseHeight),
            contentWidth: Math.max(0, baseWidth),
            contentHeight: Math.max(0, baseHeight),
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

    function childElements(page) {
        return Array.from(page?.children || []);
    }

    function createFallbackSurface(page) {
        if (!page?.ownerDocument?.createElement || typeof page.insertBefore !== 'function') return null;
        const existing = page.querySelector?.(FALLBACK_SURFACE_SELECTOR);
        if (existing) return existing;

        const content = childElements(page).filter((child) => (
            !child?.matches?.(LABEL_SELECTOR)
            && !child?.classList?.contains(BADGE_CLASS)
        ));
        if (!content.length) return null;

        const surface = page.ownerDocument.createElement('div');
        surface.className = 'reader-v2-page-zoom-surface';
        surface.dataset.readerZoomSurface = 'fallback';
        page.insertBefore(surface, content[0]);
        for (const child of content) surface.appendChild(child);
        return surface;
    }

    function surfaceForPage(page) {
        if (!page || typeof page.querySelector !== 'function') return null;
        return page.querySelector(SEMANTIC_SHELL_SELECTOR)
            || page.querySelector(FALLBACK_SURFACE_SELECTOR)
            || createFallbackSurface(page);
    }

    // Backward-compatible alias: it now returns either the semantic shell or a fallback surface.
    function shellForPage(page) {
        return surfaceForPage(page);
    }

    function addClass(element, className) {
        if (element?.classList?.add) element.classList.add(className);
    }

    function removeClass(element, className) {
        if (element?.classList?.remove) element.classList.remove(className);
    }

    function ensureBadge(page) {
        if (!page?.ownerDocument?.createElement) return null;
        const existing = childElements(page).find((child) => child?.classList?.contains(BADGE_CLASS));
        if (existing) return existing;
        const badge = page.ownerDocument.createElement('div');
        badge.className = BADGE_CLASS;
        badge.setAttribute?.('aria-hidden', 'true');
        badge.hidden = true;
        page.appendChild(badge);
        return badge;
    }

    function updateBadge(page, scale) {
        const badge = ensureBadge(page);
        if (!badge) return;
        if (scale <= MIN_SCALE + EPSILON) {
            badge.hidden = true;
            badge.textContent = '';
            return;
        }
        badge.hidden = false;
        badge.textContent = `${Math.round(scale * 100)}%`;
    }

    function applyState(page, surface, nextState) {
        if (!page || !surface) return initialState();
        const state = {
            scale: clampScale(nextState?.scale),
            x: Number(nextState?.x || 0),
            y: Number(nextState?.y || 0),
        };
        addClass(page, 'reader-v2-page--zoom-capable');
        if (state.scale <= MIN_SCALE + EPSILON) {
            state.scale = MIN_SCALE;
            state.x = 0;
            state.y = 0;
            surface.style.transform = '';
            surface.style.transformOrigin = '';
            delete page.dataset.readerZoomScale;
            removeClass(page, 'reader-v2-page--zoomed');
        } else {
            surface.style.transformOrigin = '0 0';
            surface.style.transform = `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`;
            page.dataset.readerZoomScale = state.scale.toFixed(3);
            addClass(page, 'reader-v2-page--zoomed');
        }
        updateBadge(page, state.scale);
        stateBySurface.set(surface, state);
        return state;
    }

    function pointerPointForSurface(event, surface, state) {
        const rect = surface?.getBoundingClientRect?.() || {};
        const baseLeft = Number(rect.left || 0) - Number(state?.x || 0);
        const baseTop = Number(rect.top || 0) - Number(state?.y || 0);
        return {
            x: Number(event?.clientX || 0) - baseLeft,
            y: Number(event?.clientY || 0) - baseTop,
        };
    }

    function install(rootObject) {
        const documentObject = rootObject?.document;
        const container = documentObject?.getElementById?.('readerV2Pages');
        if (!container?.addEventListener) return false;
        if (container.__readerPageZoomPanInstalled) return true;

        let drag = null;

        container.addEventListener('wheel', (event) => {
            const page = pageForTarget(event.target);
            if (!page) return;
            const surface = surfaceForPage(page);
            if (!surface) return;

            const dimensions = dimensionsFor(page, surface);
            const state = stateForSurface(surface);
            const delta = normalizeWheelDelta(event, dimensions.viewportHeight);
            const nextScale = scaleFromWheelDelta(state.scale, delta);
            if (Math.abs(nextScale - state.scale) <= EPSILON) return;

            event.preventDefault();
            const point = pointerPointForSurface(event, surface, state);
            applyState(page, surface, zoomStateAtPoint(state, nextScale, point, dimensions));
        }, { passive: false });

        container.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            const page = pageForTarget(event.target);
            if (!page) return;
            const surface = surfaceForPage(page);
            if (!surface) return;
            const state = clampPan(stateForSurface(surface), dimensionsFor(page, surface));
            if (state.scale <= MIN_SCALE + EPSILON) return;

            event.preventDefault();
            drag = {
                pointerId: event.pointerId,
                page,
                surface,
                startClientX: Number(event.clientX),
                startClientY: Number(event.clientY),
                startX: state.x,
                startY: state.y,
                scale: state.scale,
            };
            addClass(page, 'reader-v2-page--zoom-dragging');
            try { surface.setPointerCapture?.(event.pointerId); } catch (_) { /* optional */ }
        });

        container.addEventListener('pointermove', (event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            event.preventDefault();
            const next = clampPan({
                scale: drag.scale,
                x: drag.startX + (Number(event.clientX) - drag.startClientX),
                y: drag.startY + (Number(event.clientY) - drag.startClientY),
            }, dimensionsFor(drag.page, drag.surface));
            applyState(drag.page, drag.surface, next);
        });

        function finishDrag(event) {
            if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
            const active = drag;
            drag = null;
            removeClass(active.page, 'reader-v2-page--zoom-dragging');
            try { active.surface.releasePointerCapture?.(active.pointerId); } catch (_) { /* optional */ }
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
        BADGE_CLASS,
        FALLBACK_SURFACE_SELECTOR,
        INSTALL_RETRY_MS,
        INSTALL_TIMEOUT_MS,
        LABEL_SELECTOR,
        MAX_SCALE,
        MIN_SCALE,
        PAGE_SELECTOR,
        SEMANTIC_SHELL_SELECTOR,
        SHELL_SELECTOR: SEMANTIC_SHELL_SELECTOR,
        WHEEL_SENSITIVITY,
        applyState,
        clamp,
        clampPan,
        clampScale,
        createFallbackSurface,
        dimensionsFor,
        initialState,
        install,
        normalizeWheelDelta,
        pageForTarget,
        pointerPointForSurface,
        scaleFromWheelDelta,
        scheduleInstall,
        shellForPage,
        stateForShell,
        stateForSurface,
        surfaceForPage,
        updateBadge,
        zoomStateAtPoint,
    };
});
