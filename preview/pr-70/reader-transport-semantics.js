(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderTransportSemantics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const FIRST_CONTROL_ID = 'speedReadingFirst';
    const PREV_CONTROL_ID = 'speedReadingPrev';
    const NEXT_CONTROL_ID = 'speedReadingNext';
    const LAST_CONTROL_ID = 'speedReadingLast';
    const ORDINARY_ACTIONS = Object.freeze({
        [FIRST_CONTROL_ID]: 'first',
        [PREV_CONTROL_ID]: 'previous',
        [NEXT_CONTROL_ID]: 'next',
        [LAST_CONTROL_ID]: 'last',
    });

    function isPlaybackSessionEngaged(controller, rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const shared = rootObject?.ReaderPlaybackPolish?.isPlaybackSessionEngaged;
        if (typeof shared === 'function') return Boolean(shared(controller));
        const state = controller?.playback?.state;
        if (!['playing', 'paused', 'manual'].includes(state)) return false;
        const clock = controller?.trainingClock;
        if (!clock) return state === 'playing';
        return clock.state === 'running' || clock.state === 'paused';
    }

    function readerMain(controller) {
        return controller?.reader?.document?.querySelector?.('.reader-v2-main')
            || controller?.document?.querySelector?.('.reader-v2-main')
            || null;
    }

    function readerPageElements(controller) {
        const reader = controller?.reader;
        const container = reader?.element?.('readerV2Pages');
        if (!container) return [];
        const queried = container.querySelectorAll?.('.reader-v2-page');
        if (queried) return Array.from(queried);
        return Array.from(container.children || []).filter((child) => (
            String(child?.className || '').split(/\s+/u).includes('reader-v2-page')
        ));
    }

    function currentReaderPageIndex(controller) {
        const pages = readerPageElements(controller);
        if (!pages.length) return -1;
        const main = readerMain(controller);
        if (!main) return 0;

        const mainRect = main.getBoundingClientRect?.();
        if (mainRect && Number.isFinite(mainRect.top) && Number.isFinite(mainRect.bottom)) {
            const height = Math.max(1, Number(mainRect.height || (mainRect.bottom - mainRect.top) || 1));
            const probeY = Number(mainRect.top) + Math.min(height * 0.35, 180);
            let nearestIndex = 0;
            let nearestDistance = Number.POSITIVE_INFINITY;
            for (let index = 0; index < pages.length; index += 1) {
                const rect = pages[index]?.getBoundingClientRect?.();
                if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) continue;
                if (rect.top <= probeY && rect.bottom > probeY) return index;
                const distance = Math.min(Math.abs(rect.top - probeY), Math.abs(rect.bottom - probeY));
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = index;
                }
            }
            if (nearestDistance < Number.POSITIVE_INFINITY) return nearestIndex;
        }

        const probe = Number(main.scrollTop || 0) + Math.max(1, Number(main.clientHeight || 1)) * 0.35;
        let nearestIndex = 0;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < pages.length; index += 1) {
            const top = Number(pages[index]?.offsetTop || 0);
            const height = Math.max(1, Number(pages[index]?.offsetHeight || 1));
            if (top <= probe && top + height > probe) return index;
            const distance = Math.min(Math.abs(top - probe), Math.abs(top + height - probe));
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestIndex = index;
            }
        }
        return nearestIndex;
    }

    function setTransportLabels(controller, ordinary) {
        const first = controller?.element?.(FIRST_CONTROL_ID);
        const prev = controller?.element?.(PREV_CONTROL_ID);
        const next = controller?.element?.(NEXT_CONTROL_ID);
        const last = controller?.element?.(LAST_CONTROL_ID);
        const labels = ordinary
            ? [
                [first, '首页'],
                [prev, '上一页'],
                [next, '下一页'],
                [last, '尾页'],
            ]
            : [
                [first, '到头（第一帧）'],
                [prev, '上一帧'],
                [next, '下一帧'],
                [last, '到尾（最后一帧）'],
            ];
        for (const [button, title] of labels) {
            if (!button) continue;
            button.title = title;
            button.setAttribute?.('aria-label', title);
        }
        const toolbar = controller?.element?.('speedReadingV2Toolbar');
        const hint = toolbar?.querySelector?.('.speed-reading-v2-shortcuts');
        if (hint) {
            hint.textContent = ordinary
                ? '←/→ 上一页/下一页 · Home/End 首页/尾页 · Space 开始速度阅读'
                : 'Space 播放/暂停 · ←/→ 上一帧/下一帧 · Home/End 第一帧/最后一帧 · Esc 停止';
        }
    }

    function applyStartPendingVisual(controller, pending = Boolean(controller?.__readerSpeedStartPending)) {
        const button = controller?.element?.('readingToggleBtn');
        if (!button || !pending) return false;
        button.disabled = true;
        button.textContent = '⏳';
        button.title = '正在准备速度阅读…';
        button.setAttribute?.('aria-label', button.title);
        return true;
    }

    function applyReaderPageControlState(controller, rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        if (!controller) return false;
        const ordinary = !isPlaybackSessionEngaged(controller, rootObject);
        setTransportLabels(controller, ordinary);
        if (!ordinary) {
            applyStartPendingVisual(controller);
            return false;
        }

        const reader = controller.reader;
        const pages = readerPageElements(controller);
        const readable = Boolean(controller.isReaderActive?.() && reader?.openResponse && pages.length);
        const index = readable ? currentReaderPageIndex(controller) : -1;
        const pending = Boolean(controller.__readerPageNavigationPending);
        const hasMore = Boolean(reader?.hasMore);
        const atFirst = index <= 0;
        const atLoadedLast = index < 0 || index >= pages.length - 1;
        const atTrueLast = atLoadedLast && !hasMore;

        const first = controller.element?.(FIRST_CONTROL_ID);
        const prev = controller.element?.(PREV_CONTROL_ID);
        const next = controller.element?.(NEXT_CONTROL_ID);
        const last = controller.element?.(LAST_CONTROL_ID);
        if (first) first.disabled = !readable || pending || atFirst;
        if (prev) prev.disabled = !readable || pending || atFirst;
        if (next) next.disabled = !readable || pending || atTrueLast;
        if (last) last.disabled = !readable || pending || atTrueLast;
        applyStartPendingVisual(controller);
        return true;
    }

    function locationForPage(controller, index) {
        const reader = controller?.reader;
        const page = reader?.presentationState?.pages?.[index];
        const node = page?.nodes?.[0];
        if (!node?.node_id) return null;
        return reader.locationForNode?.(node.node_id) || node.location || { node_id: node.node_id };
    }

    function scrollToReaderPage(controller, index, options = {}, rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const pages = readerPageElements(controller);
        if (!pages.length) return false;
        const bounded = Math.max(0, Math.min(pages.length - 1, Number(index) || 0));
        const page = pages[bounded];
        page?.scrollIntoView?.({ block: 'start', behavior: options.behavior || 'smooth' });
        const location = locationForPage(controller, bounded);
        if (location?.node_id) {
            controller.reader.lastLocation = location;
            if (options.persist !== false) controller.reader.persistLocation?.(location);
        }
        controller.__readerOrdinaryPageIndex = bounded;
        const refresh = () => applyReaderPageControlState(controller, rootObject);
        if (typeof rootObject?.requestAnimationFrame === 'function') rootObject.requestAnimationFrame(refresh);
        else refresh();
        return true;
    }

    function yieldToBrowser(rootObject) {
        if (typeof rootObject?.requestAnimationFrame === 'function') {
            return new Promise((resolve) => rootObject.requestAnimationFrame(() => resolve()));
        }
        if (typeof rootObject?.setTimeout === 'function') {
            return new Promise((resolve) => rootObject.setTimeout(resolve, 0));
        }
        return Promise.resolve();
    }

    async function ensureReaderPageAvailable(controller, targetIndex, rootObject) {
        const reader = controller?.reader;
        while (reader?.hasMore && readerPageElements(controller).length <= targetIndex) {
            await reader.loadMore?.({ silent: true });
            await yieldToBrowser(rootObject);
        }
        return readerPageElements(controller).length > targetIndex;
    }

    async function ensureReaderTailLoaded(controller, rootObject) {
        const reader = controller?.reader;
        while (reader?.hasMore) {
            await reader.loadMore?.({ silent: true });
            reader.setStatus?.(`正在定位尾页… 已加载 ${Number(reader.nodes?.length || 0)} 个内容块`);
            await yieldToBrowser(rootObject);
        }
        reader?.setStatus?.('');
        return readerPageElements(controller).length;
    }

    async function navigateReaderPage(controller, action, rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        if (!controller?.isReaderActive?.() || isPlaybackSessionEngaged(controller, rootObject)) return false;
        if (controller.__readerPageNavigationPending) return false;
        const reader = controller.reader;
        let pages = readerPageElements(controller);
        if (!reader?.openResponse || !pages.length) return false;

        controller.__readerPageNavigationPending = true;
        applyReaderPageControlState(controller, rootObject);
        try {
            let current = currentReaderPageIndex(controller);
            if (current < 0) current = 0;
            if (action === 'first') return scrollToReaderPage(controller, 0, {}, rootObject);
            if (action === 'last') {
                await ensureReaderTailLoaded(controller, rootObject);
                pages = readerPageElements(controller);
                return pages.length
                    ? scrollToReaderPage(controller, pages.length - 1, {}, rootObject)
                    : false;
            }
            if (action === 'previous') {
                return scrollToReaderPage(controller, Math.max(0, current - 1), {}, rootObject);
            }
            if (action === 'next') {
                const target = current + 1;
                if (target >= pages.length) {
                    await ensureReaderPageAvailable(controller, target, rootObject);
                    pages = readerPageElements(controller);
                }
                if (target >= pages.length) return false;
                return scrollToReaderPage(controller, target, {}, rootObject);
            }
            return false;
        } catch (error) {
            reader?.renderError?.(error);
            return false;
        } finally {
            controller.__readerPageNavigationPending = false;
            applyReaderPageControlState(controller, rootObject);
        }
    }

    function wrapStartReadiness(target, rootObject) {
        if (!target || typeof target.start !== 'function') return false;
        if (Object.prototype.hasOwnProperty.call(target, '__readerStartReadinessWrapped')) return false;
        const original = target.start;
        target.start = function startWithReadinessFeedback(...args) {
            if (this.__readerSpeedStartPromise) return this.__readerSpeedStartPromise;
            this.__readerSpeedStartPending = true;
            this.reader?.setStatus?.('正在准备速度阅读…');
            applyStartPendingVisual(this, true);

            const pending = Promise.resolve()
                .then(() => original.apply(this, args))
                .then((started) => {
                    if (started) this.reader?.setStatus?.('');
                    else this.reader?.setStatus?.('当前内容没有可播放的速度阅读帧。', 'info');
                    return started;
                })
                .finally(() => {
                    this.__readerSpeedStartPending = false;
                    this.__readerSpeedStartPromise = null;
                    this.updateControls?.();
                    applyReaderPageControlState(this, rootObject);
                });
            this.__readerSpeedStartPromise = pending;
            return pending;
        };
        Object.defineProperty(target, '__readerStartReadinessWrapped', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function wrapReaderSurfaceActivation(rootObject) {
        const ReaderController = rootObject?.ReaderUIV2?.ReaderV2Controller;
        const prototype = ReaderController?.prototype;
        if (!prototype || typeof prototype.activateReaderSurface !== 'function') return false;
        if (Object.prototype.hasOwnProperty.call(prototype, '__readerSurfacePlaybackReadinessWrapped')) return false;
        const original = prototype.activateReaderSurface;
        prototype.activateReaderSurface = function activateReaderSurfaceWithPlaybackReadiness(...args) {
            const result = original.apply(this, args);
            const playbackController = rootObject?.ReaderSpeedPlaybackUI?.getDefaultController?.();
            if (playbackController?.reader === this) {
                playbackController.updateControls?.();
                applyReaderPageControlState(playbackController, rootObject);
            }
            return result;
        };
        Object.defineProperty(prototype, '__readerSurfacePlaybackReadinessWrapped', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function wrapUpdateControls(target, rootObject) {
        if (!target || typeof target.updateControls !== 'function') return false;
        if (Object.prototype.hasOwnProperty.call(target, '__readerTransportSemanticsWrapped')) return false;
        const original = target.updateControls;
        target.updateControls = function updateControlsWithReaderPageSemantics(...args) {
            const result = original.apply(this, args);
            applyReaderPageControlState(this, rootObject);
            applyStartPendingVisual(this);
            return result;
        };
        Object.defineProperty(target, '__readerTransportSemanticsWrapped', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function bindReaderScroll(controller, rootObject) {
        const main = readerMain(controller);
        if (!main?.addEventListener || main.dataset?.readerTransportSemanticsBound === '1') return false;
        if (main.dataset) main.dataset.readerTransportSemanticsBound = '1';
        let scheduled = false;
        main.addEventListener('scroll', () => {
            if (scheduled) return;
            scheduled = true;
            const refresh = () => {
                scheduled = false;
                applyReaderPageControlState(controller, rootObject);
            };
            if (typeof rootObject?.requestAnimationFrame === 'function') rootObject.requestAnimationFrame(refresh);
            else refresh();
        }, { passive: true });
        return true;
    }

    function controlFromEvent(event) {
        const target = event?.target;
        if (target?.id && ORDINARY_ACTIONS[target.id]) return target;
        return target?.closest?.('#speedReadingFirst, #speedReadingPrev, #speedReadingNext, #speedReadingLast') || null;
    }

    function bindWindowTransportCapture(controller, rootObject) {
        if (!rootObject?.addEventListener || rootObject.__readerTransportSemanticsCaptureBound) return false;
        rootObject.__readerTransportSemanticsCaptureBound = true;
        rootObject.addEventListener('click', (event) => {
            const button = controlFromEvent(event);
            const action = button?.id ? ORDINARY_ACTIONS[button.id] : null;
            if (!action || !controller?.isReaderActive?.() || isPlaybackSessionEngaged(controller, rootObject)) return;
            event.preventDefault?.();
            event.stopPropagation?.();
            event.stopImmediatePropagation?.();
            Promise.resolve(navigateReaderPage(controller, action, rootObject)).catch((error) => (
                controller.reader?.renderError?.(error)
            ));
        }, true);

        rootObject.addEventListener('keydown', (event) => {
            if (!controller?.isReaderActive?.() || isPlaybackSessionEngaged(controller, rootObject)) return;
            if (controller.isEditableTarget?.(event?.target)) return;
            const action = event?.key === 'Home'
                ? 'first'
                : event?.key === 'End'
                    ? 'last'
                    : event?.key === 'ArrowLeft'
                        ? 'previous'
                        : event?.key === 'ArrowRight'
                            ? 'next'
                            : null;
            if (!action) return;
            event.preventDefault?.();
            event.stopPropagation?.();
            event.stopImmediatePropagation?.();
            Promise.resolve(navigateReaderPage(controller, action, rootObject)).catch((error) => (
                controller.reader?.renderError?.(error)
            ));
        }, true);
        return true;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const PlaybackUI = rootObject?.ReaderSpeedPlaybackUI;
        const Controller = PlaybackUI?.ReaderSpeedPlaybackUIController;
        if (!Controller) return false;
        wrapReaderSurfaceActivation(rootObject);
        wrapStartReadiness(Controller.prototype, rootObject);
        wrapUpdateControls(Controller.prototype, rootObject);
        const controller = PlaybackUI?.getDefaultController?.();
        if (!controller) return false;
        wrapUpdateControls(controller, rootObject);
        bindWindowTransportCapture(controller, rootObject);
        bindReaderScroll(controller, rootObject);
        controller.updateControls?.();
        applyReaderPageControlState(controller, rootObject);
        return true;
    }

    return {
        FIRST_CONTROL_ID,
        LAST_CONTROL_ID,
        NEXT_CONTROL_ID,
        ORDINARY_ACTIONS,
        PREV_CONTROL_ID,
        applyReaderPageControlState,
        applyStartPendingVisual,
        bindReaderScroll,
        bindWindowTransportCapture,
        currentReaderPageIndex,
        ensureReaderPageAvailable,
        ensureReaderTailLoaded,
        install,
        isPlaybackSessionEngaged,
        locationForPage,
        navigateReaderPage,
        readerMain,
        readerPageElements,
        scrollToReaderPage,
        setTransportLabels,
        wrapReaderSurfaceActivation,
        wrapStartReadiness,
        wrapUpdateControls,
        yieldToBrowser,
    };
});