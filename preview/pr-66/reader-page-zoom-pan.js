(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.ReaderPageZoomPanV2 = api;
        if (root.document) api.scheduleInstall(root);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const MIN_SCALE = 0.5;
    const MAX_SCALE = 4;
    const WHEEL_SENSITIVITY = 0.0015;
    const INSTALL_RETRY_MS = 25;
    const INSTALL_TIMEOUT_MS = 10000;
    const PAGE_SELECTOR = '.reader-v2-page';
    const VIEWPORT_SELECTOR = '.reader-v2-main';
    const RAIL_SELECTOR = '#readerStudyToolsRail';
    const RAIL_TABS_SELECTOR = '.reader-study-tools-tabs';
    const INDICATOR_CLASS = 'reader-page-zoom-indicator';
    const EPSILON = 1e-6;

    const stateByPage = new WeakMap();
    let activeScale = 1;

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function clampScale(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 1;
        return clamp(numeric, MIN_SCALE, MAX_SCALE);
    }

    function initialState() {
        return { scale: 1, x: 0, y: 0 };
    }

    function stateForPage(page) {
        if (!page) return initialState();
        let state = stateByPage.get(page);
        if (!state) {
            state = initialState();
            stateByPage.set(page, state);
        }
        return state;
    }

    function pageForTarget(target) {
        if (!target || typeof target.closest !== 'function') return null;
        return target.closest(PAGE_SELECTOR);
    }

    function viewportForPage(page) {
        if (!page || typeof page.closest !== 'function') return null;
        return page.closest(VIEWPORT_SELECTOR);
    }

    function railForPage(page) {
        const panel = page?.closest?.('.reading-panel');
        return panel?.querySelector?.(RAIL_SELECTOR)
            || page?.ownerDocument?.querySelector?.(RAIL_SELECTOR)
            || null;
    }

    function finiteNumber(value, fallback = 0) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallback;
    }

    function rectEdges(rect) {
        const left = finiteNumber(rect?.left, 0);
        const top = finiteNumber(rect?.top, 0);
        const width = Math.max(0, finiteNumber(rect?.width, finiteNumber(rect?.right, left) - left));
        const height = Math.max(0, finiteNumber(rect?.height, finiteNumber(rect?.bottom, top) - top));
        const right = Number.isFinite(Number(rect?.right)) ? Number(rect.right) : left + width;
        const bottom = Number.isFinite(Number(rect?.bottom)) ? Number(rect.bottom) : top + height;
        return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    }

    function clipViewportRect(viewportRect, railRect) {
        const viewport = rectEdges(viewportRect);
        if (!railRect) return viewport;
        const rail = rectEdges(railRect);
        const overlapsVertically = rail.bottom > viewport.top && rail.top < viewport.bottom;
        const railStartsInsideViewport = rail.left > viewport.left && rail.left < viewport.right;
        const right = overlapsVertically && railStartsInsideViewport
            ? Math.min(viewport.right, rail.left)
            : viewport.right;
        return {
            ...viewport,
            right,
            width: Math.max(0, right - viewport.left),
        };
    }

    function effectiveViewportForPage(page) {
        const viewport = viewportForPage(page);
        const rail = railForPage(page);
        const viewportRect = viewport?.getBoundingClientRect?.() || {};
        const railRect = rail?.getBoundingClientRect?.() || null;
        return {
            viewport,
            rail,
            rect: clipViewportRect(viewportRect, railRect),
        };
    }

    function dimensionsFor(page, state = stateForPage(page)) {
        const effectiveViewport = effectiveViewportForPage(page);
        const viewport = effectiveViewport.viewport;
        const viewportRect = effectiveViewport.rect;
        const pageRect = page?.getBoundingClientRect?.() || {};
        const scale = Math.max(EPSILON, clampScale(state?.scale));
        const pageWidth = Number(page?.offsetWidth || page?.clientWidth || (Number(pageRect.width || 0) / scale) || 0);
        const pageHeight = Number(page?.offsetHeight || page?.clientHeight || (Number(pageRect.height || 0) / scale) || 0);
        const currentX = Number(state?.x || 0);
        const currentY = Number(state?.y || 0);
        return {
            viewport,
            rail: effectiveViewport.rail,
            viewportLeft: viewportRect.left,
            viewportTop: viewportRect.top,
            viewportWidth: Math.max(0, viewportRect.width),
            viewportHeight: Math.max(0, viewportRect.height),
            pageWidth: Math.max(0, pageWidth),
            pageHeight: Math.max(0, pageHeight),
            baseLeft: Number(pageRect.left || 0) - Number(viewportRect.left || 0) - currentX,
            baseTop: Number(pageRect.top || 0) - Number(viewportRect.top || 0) - currentY,
        };
    }

    function panBounds(scaleValue, dimensions) {
        const scale = clampScale(scaleValue);
        const viewportWidth = Math.max(0, Number(dimensions?.viewportWidth || 0));
        const viewportHeight = Math.max(0, Number(dimensions?.viewportHeight || 0));
        const pageWidth = Math.max(0, Number(dimensions?.pageWidth || 0));
        const pageHeight = Math.max(0, Number(dimensions?.pageHeight || 0));
        const baseLeft = Number(dimensions?.baseLeft || 0);
        const baseTop = Number(dimensions?.baseTop || 0);
        const scaledWidth = pageWidth * scale;
        const scaledHeight = pageHeight * scale;

        if (scale < 1 - EPSILON) {
            const centeredX = ((viewportWidth - scaledWidth) / 2) - baseLeft;
            return { minX: centeredX, maxX: centeredX, minY: 0, maxY: 0 };
        }
        if (Math.abs(scale - 1) <= EPSILON) {
            return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        }

        const minX = Math.min(0, viewportWidth - scaledWidth - baseLeft);
        const maxX = Math.max(0, -baseLeft);
        const minY = Math.min(0, viewportHeight - scaledHeight - baseTop);
        const maxY = Math.max(0, -baseTop);
        return { minX, maxX, minY, maxY };
    }

    function clampPan(state, dimensions) {
        const scale = clampScale(state?.scale);
        const bounds = panBounds(scale, dimensions);
        return {
            scale,
            x: clamp(Number(state?.x || 0), bounds.minX, bounds.maxX),
            y: clamp(Number(state?.y || 0), bounds.minY, bounds.maxY),
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
        if (Math.abs(scale - 1) <= EPSILON) return initialState();
        if (Math.abs(scale - current.scale) <= EPSILON) return current;

        if (scale < 1) return clampPan({ scale, x: 0, y: 0 }, dimensions);

        const pointX = Number(point?.x || 0);
        const pointY = Number(point?.y || 0);
        const baseLeft = Number(dimensions?.baseLeft || 0);
        const baseTop = Number(dimensions?.baseTop || 0);
        const contentX = (pointX - baseLeft - current.x) / current.scale;
        const contentY = (pointY - baseTop - current.y) / current.scale;
        return clampPan({
            scale,
            x: pointX - baseLeft - (contentX * scale),
            y: pointY - baseTop - (contentY * scale),
        }, dimensions);
    }

    function normalizeWheelDelta(event, viewportHeight) {
        let delta = Number(event?.deltaY || 0);
        if (!Number.isFinite(delta)) return 0;
        if (event?.deltaMode === 1) delta *= 16;
        else if (event?.deltaMode === 2) delta *= Math.max(1, Number(viewportHeight || 800));
        return delta;
    }

    function shrinkLayoutOffset(pageHeight, scaleValue) {
        const scale = clampScale(scaleValue);
        if (scale >= 1) return 0;
        return -Math.max(0, Number(pageHeight || 0)) * (1 - scale);
    }

    function formatScalePercent(scaleValue) {
        return `${Math.round(clampScale(scaleValue) * 100)}%`;
    }

    function ensureZoomIndicator(documentObject) {
        const rail = documentObject?.querySelector?.(RAIL_SELECTOR);
        const tabs = rail?.querySelector?.(RAIL_TABS_SELECTOR);
        if (!tabs) return null;
        let indicator = tabs.querySelector?.(`.${INDICATOR_CLASS}`);
        if (!indicator) {
            indicator = documentObject.createElement('div');
            indicator.className = INDICATOR_CLASS;
            indicator.setAttribute('role', 'status');
            indicator.setAttribute('aria-live', 'polite');
            indicator.setAttribute('aria-label', '页面缩放');
            indicator.title = '页面缩放';
            tabs.appendChild(indicator);
        }
        indicator.textContent = formatScalePercent(activeScale);
        return indicator;
    }

    function updateZoomIndicator(documentObject, scaleValue) {
        activeScale = clampScale(scaleValue);
        const indicator = ensureZoomIndicator(documentObject);
        if (indicator) indicator.textContent = formatScalePercent(activeScale);
        return indicator;
    }

    function scheduleIndicatorMount(rootObject) {
        const documentObject = rootObject?.document;
        if (!documentObject || documentObject.__readerZoomIndicatorMountScheduled) return false;
        documentObject.__readerZoomIndicatorMountScheduled = true;
        const started = Date.now();
        function attempt() {
            if (ensureZoomIndicator(documentObject)) return true;
            if (Date.now() - started >= INSTALL_TIMEOUT_MS) return false;
            rootObject?.setTimeout?.(attempt, INSTALL_RETRY_MS);
            return false;
        }
        return attempt();
    }

    function addClass(element, className) {
        if (element?.classList?.add) element.classList.add(className);
    }

    function removeClass(element, className) {
        if (element?.classList?.remove) element.classList.remove(className);
    }

    function applyState(page, nextState) {
        if (!page) return initialState();
        const dimensions = dimensionsFor(page, stateForPage(page));
        let state = clampPan({
            scale: clampScale(nextState?.scale),
            x: Number(nextState?.x || 0),
            y: Number(nextState?.y || 0),
        }, dimensions);

        if (Math.abs(state.scale - 1) <= EPSILON) state = initialState();

        page.style.transformOrigin = '0 0';
        page.style.transform = state.scale === 1
            ? ''
            : `translate3d(${state.x}px, ${state.y}px, 0) scale(${state.scale})`;
        const layoutOffset = shrinkLayoutOffset(dimensions.pageHeight, state.scale);
        page.style.marginBottom = layoutOffset ? `${layoutOffset}px` : '';
        page.dataset.readerZoomScale = state.scale.toFixed(3);

        if (state.scale > 1 + EPSILON) {
            addClass(page, 'reader-v2-page--zoomed-in');
            removeClass(page, 'reader-v2-page--zoomed-out');
        } else if (state.scale < 1 - EPSILON) {
            addClass(page, 'reader-v2-page--zoomed-out');
            removeClass(page, 'reader-v2-page--zoomed-in');
        } else {
            removeClass(page, 'reader-v2-page--zoomed-in');
            removeClass(page, 'reader-v2-page--zoomed-out');
        }
        addClass(page, 'reader-v2-page--zoom-capable');
        stateByPage.set(page, state);
        updateZoomIndicator(page.ownerDocument, state.scale);
        return state;
    }

    function install(rootObject) {
        const documentObject = rootObject?.document;
        const container = documentObject?.getElementById?.('readerV2Pages');
        if (!container?.addEventListener) return false;
        if (container.__readerPageZoomPanInstalled) {
            scheduleIndicatorMount(rootObject);
            return true;
        }

        let drag = null;

        container.addEventListener('wheel', (event) => {
            const page = pageForTarget(event.target);
            if (!page) return;
            const state = stateForPage(page);
            const dimensions = dimensionsFor(page, state);
            const delta = normalizeWheelDelta(event, dimensions.viewportHeight);
            const nextScale = scaleFromWheelDelta(state.scale, delta);
            if (Math.abs(nextScale - state.scale) <= EPSILON) return;

            event.preventDefault();
            const point = {
                x: Number(event.clientX) - Number(dimensions.viewportLeft || 0),
                y: Number(event.clientY) - Number(dimensions.viewportTop || 0),
            };
            applyState(page, zoomStateAtPoint(state, nextScale, point, dimensions));
        }, { passive: false });

        container.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            const page = pageForTarget(event.target);
            if (!page) return;
            const state = clampPan(stateForPage(page), dimensionsFor(page, stateForPage(page)));
            if (state.scale <= 1 + EPSILON) return;

            event.preventDefault();
            drag = {
                pointerId: event.pointerId,
                page,
                startClientX: Number(event.clientX),
                startClientY: Number(event.clientY),
                startX: state.x,
                startY: state.y,
                scale: state.scale,
            };
            addClass(page, 'reader-v2-page--zoom-dragging');
            try { page.setPointerCapture?.(event.pointerId); } catch (_) { /* optional */ }
        });

        container.addEventListener('pointermove', (event) => {
            if (!drag || event.pointerId !== drag.pointerId) return;
            event.preventDefault();
            const dimensions = dimensionsFor(drag.page, stateForPage(drag.page));
            const next = clampPan({
                scale: drag.scale,
                x: drag.startX + (Number(event.clientX) - drag.startClientX),
                y: drag.startY + (Number(event.clientY) - drag.startClientY),
            }, dimensions);
            applyState(drag.page, next);
        });

        function finishDrag(event) {
            if (!drag || (event?.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
            const active = drag;
            drag = null;
            removeClass(active.page, 'reader-v2-page--zoom-dragging');
            try { active.page.releasePointerCapture?.(active.pointerId); } catch (_) { /* optional */ }
        }

        container.addEventListener('pointerup', finishDrag);
        container.addEventListener('pointercancel', finishDrag);
        container.addEventListener('lostpointercapture', finishDrag);
        container.addEventListener('dragstart', (event) => {
            const page = pageForTarget(event.target);
            if (page?.classList?.contains('reader-v2-page--zoomed-in')) event.preventDefault();
        });

        documentObject.addEventListener?.('reader-study-tools-layout-change', () => {
            ensureZoomIndicator(documentObject);
            const pages = container.querySelectorAll?.(PAGE_SELECTOR) || [];
            for (const page of pages) {
                const state = stateForPage(page);
                if (Math.abs(state.scale - 1) > EPSILON) applyState(page, state);
            }
        });

        Object.defineProperty(container, '__readerPageZoomPanInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        scheduleIndicatorMount(rootObject);
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
        INDICATOR_CLASS,
        INSTALL_RETRY_MS,
        INSTALL_TIMEOUT_MS,
        MAX_SCALE,
        MIN_SCALE,
        PAGE_SELECTOR,
        RAIL_SELECTOR,
        RAIL_TABS_SELECTOR,
        VIEWPORT_SELECTOR,
        WHEEL_SENSITIVITY,
        applyState,
        clamp,
        clampPan,
        clampScale,
        clipViewportRect,
        dimensionsFor,
        effectiveViewportForPage,
        ensureZoomIndicator,
        formatScalePercent,
        initialState,
        install,
        normalizeWheelDelta,
        pageForTarget,
        panBounds,
        railForPage,
        scaleFromWheelDelta,
        scheduleIndicatorMount,
        scheduleInstall,
        shrinkLayoutOffset,
        stateForPage,
        updateZoomIndicator,
        viewportForPage,
        zoomStateAtPoint,
    };
});
