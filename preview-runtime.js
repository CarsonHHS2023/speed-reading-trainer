(function (root) {
    'use strict';

    const PREVIEW_PATH_PATTERN = /\/preview\/pr-\d+(?:\/|$)/;
    const pathname = String(root.location?.pathname || '');
    if (!PREVIEW_PATH_PATTERN.test(pathname)) {
        root.console?.info?.('[preview] runtime skipped outside PR preview', { pathname });
        return;
    }

    const PRODUCTION_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service.hf.space';
    const TEST_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service-ocrmypdf-test.hf.space';
    const AUTO_LOAD_THRESHOLD_PX = 600;
    const AUTO_LOAD_MIN_SCROLL_ADVANCE_PX = 120;

    root.SPEED_READING_CONFIG = Object.freeze({
        environment: 'preview',
        frontendBranch: 'preview-txt-hf-test',
        backendBranch: 'deploy/ocrmypdf-test',
        apiBaseUrl: TEST_API_BASE_URL,
    });
    root.READER_API_BASE_URL = TEST_API_BASE_URL;
    root.API_BASE_URL_OVERRIDE = TEST_API_BASE_URL;

    function rewriteUrl(value) {
        const url = String(value || '');
        return url.startsWith(PRODUCTION_API_BASE_URL)
            ? `${TEST_API_BASE_URL}${url.slice(PRODUCTION_API_BASE_URL.length)}`
            : url;
    }

    const nativeFetch = root.fetch && root.fetch.bind(root);
    if (!nativeFetch) throw new Error('Preview runtime requires window.fetch');

    root.fetch = function previewFetch(input, init) {
        if (typeof input === 'string' || input instanceof URL) {
            return nativeFetch(rewriteUrl(input), init);
        }

        const RequestCtor = root.Request || (typeof Request !== 'undefined' ? Request : null);
        if (RequestCtor && input instanceof RequestCtor) {
            const rewritten = rewriteUrl(input.url);
            return nativeFetch(rewritten === input.url ? input : new RequestCtor(rewritten, input), init);
        }

        return nativeFetch(input, init);
    };

    function presentationPageSignature(page) {
        return [
            String(page?.presentation_id || ''),
            String(page?.kind || ''),
            ...(page?.nodes || []).map((node) => String(node?.node_id || '')),
        ].join('\u001f');
    }

    function renderIncrementalReflow(controller, previousState) {
        const container = controller.element?.('readerV2Pages');
        if (!container) return;

        const pages = controller.presentationState?.pages || [];
        const previousPages = previousState?.pages || [];
        let stablePrefix = 0;
        const childCount = Number(container.children?.length || 0);
        const comparable = Math.min(previousPages.length, pages.length, childCount);

        while (stablePrefix < comparable) {
            const previousPage = previousPages[stablePrefix];
            const nextPage = pages[stablePrefix];
            const child = container.children?.[stablePrefix];
            if (!child) break;
            if (String(child.dataset?.presentationId || '') !== String(nextPage?.presentation_id || '')) break;
            if (presentationPageSignature(previousPage) !== presentationPageSignature(nextPage)) break;
            stablePrefix += 1;
        }

        while (Number(container.children?.length || 0) > stablePrefix) {
            container.removeChild(container.children[stablePrefix]);
        }

        for (let index = stablePrefix; index < pages.length; index += 1) {
            const page = pages[index];
            const section = controller.document.createElement('section');
            section.className = `reader-v2-page reader-v2-page-${page.kind}`;
            section.dataset.presentationId = page.presentation_id;
            for (const node of page.nodes || []) section.appendChild(controller.renderNode(node));
            container.appendChild(section);
        }

        if (!pages.length) {
            const empty = controller.document.createElement('p');
            empty.className = 'reader-v2-empty';
            empty.textContent = '当前文档没有可显示的语义内容。';
            container.appendChild(empty);
        }
    }

    function playbackFrameContainsNode(frame, nodeId) {
        const expected = String(nodeId || '').trim();
        if (!expected || !frame) return false;
        const sharedMatcher = root.ReaderPlaybackController?.frameContainsNode;
        if (typeof sharedMatcher === 'function') return Boolean(sharedMatcher(frame, expected));
        if (String(frame?.identity?.node_id || '').trim() === expected) return true;
        return (frame?.source_spans || []).some((identity) => (
            String(identity?.node_id || '').trim() === expected
        ));
    }

    function playbackControllerForReader(readerController) {
        const controller = root.ReaderSpeedPlaybackUI?.getDefaultController?.();
        if (!controller?.playback || !controller?.adapter || !readerController?.openResponse) return null;
        if (controller.reader !== readerController) controller.reader = readerController;
        return controller;
    }

    function isPlaybackBrowseOnly(controller) {
        const clockState = controller?.trainingClock?.state;
        if (clockState === 'running' || clockState === 'paused') return false;
        if (!controller?.trainingClock && controller?.playback?.state === 'playing') return false;
        return true;
    }

    function syncPlaybackCursorToReaderNode(readerController, nodeId) {
        try {
            const controller = playbackControllerForReader(readerController);
            if (!controller || !isPlaybackBrowseOnly(controller)) return false;

            const findFrameIndex = () => (controller.playback?.frames || []).findIndex((frame) => (
                playbackFrameContainsNode(frame, nodeId)
            ));
            let index = findFrameIndex();
            if (index < 0 && typeof controller.refreshFrames === 'function') {
                controller.refreshFrames({ preserveIdentity: false });
                index = findFrameIndex();
            }

            const frameCount = Number(controller.playback?.frames?.length || 0);
            if (index < 0 || frameCount <= 0 || typeof controller.playback?.seek !== 'function') return false;
            controller.pendingResumeFrameIndex = null;
            controller.playback.seek(index / frameCount, { activate: false });
            return true;
        } catch (_error) {
            return false;
        }
    }

    function playbackFrameLocation(frame) {
        if (frame?.identity?.node_id) return frame.identity;
        return (frame?.source_spans || []).find((identity) => identity?.node_id) || null;
    }

    function settlePlaybackBrowseAtCurrentFrame(controller, frame) {
        if (!controller || !frame || !isPlaybackBrowseOnly(controller)) return frame;
        const snapshot = controller.playback?.snapshot?.();
        if (snapshot?.frame_count > 0 && typeof controller.playback?.seek === 'function') {
            controller.playback.seek(snapshot.index / snapshot.frame_count, { activate: false });
        }

        const location = playbackFrameLocation(frame);
        const reader = controller.reader;
        if (!location?.node_id || typeof reader?.navigateTo !== 'function') return frame;
        Promise.resolve(reader.navigateTo(location, {
            persist: false,
            behavior: 'auto',
            playbackBrowse: true,
        })).then((navigated) => {
            if (navigated === false) return;
            reader.persistLocation?.(location, {
                frameId: frame.frame_id || null,
                frameOrdinal: Number.isInteger(frame.frame_ordinal) ? frame.frame_ordinal : null,
            });
        }).catch((error) => reader.renderError?.(error));
        return frame;
    }

    function installPlaybackBrowseTransportCapture() {
        const documentObject = root.document;
        if (!documentObject?.addEventListener || documentObject.__previewPlaybackBrowseTransportBound) return false;
        documentObject.__previewPlaybackBrowseTransportBound = true;
        const destinations = Object.freeze({
            speedReadingFirst: 'first',
            speedReadingPrev: 'previous',
            speedReadingNext: 'next',
            speedReadingLast: 'last',
        });

        documentObject.addEventListener('click', (event) => {
            const target = event?.target;
            const button = target?.id && destinations[target.id]
                ? target
                : target?.closest?.('#speedReadingFirst, #speedReadingPrev, #speedReadingNext, #speedReadingLast');
            const action = button?.id ? destinations[button.id] : null;
            if (!action) return;

            const controller = root.ReaderSpeedPlaybackUI?.getDefaultController?.();
            if (!controller?.isReaderActive?.() || !isPlaybackBrowseOnly(controller)) return;
            const snapshot = controller.playback?.snapshot?.();
            if (!snapshot?.frame_count || typeof controller.playback?.moveBy !== 'function') return;

            event.preventDefault?.();
            event.stopPropagation?.();
            event.stopImmediatePropagation?.();
            let destination = snapshot.index;
            if (action === 'first') destination = 0;
            else if (action === 'previous') destination = Math.max(0, snapshot.index - 1);
            else if (action === 'next') destination = Math.min(snapshot.frame_count - 1, snapshot.index + 1);
            else if (action === 'last') destination = snapshot.frame_count - 1;
            const frame = controller.playback.moveBy(destination - snapshot.index);
            settlePlaybackBrowseAtCurrentFrame(controller, frame);
        }, true);
        return true;
    }

    function installPlaybackBrowsingIsolation() {
        const prototype = root.ReaderSpeedPlaybackUI?.ReaderSpeedPlaybackUIController?.prototype;
        if (!prototype || prototype.__previewBrowsingIsolationInstalled) return false;

        prototype.restoreResumeFrame = function previewRestoreResumeFrame() {
            const record = this.reader?.resumeRecord;
            if ((!record?.frame_id && record?.frame_ordinal == null) || !this.playback.frames.length) return false;
            let index = record.frame_id
                ? this.playback.frames.findIndex((frame) => frame.frame_id === record.frame_id)
                : -1;
            if (index < 0 && record.node_id) {
                index = this.playback.frames.findIndex((frame) => (
                    frame?.identity?.node_id === record.node_id
                    && (record.frame_ordinal == null || frame.frame_ordinal === record.frame_ordinal)
                ));
            }
            if (index < 0) return false;
            this.playback.seek(index / this.playback.frames.length, { activate: false });
            return true;
        };

        Object.defineProperty(prototype, '__previewBrowsingIsolationInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function installIncrementalReaderChunkRendering() {
        const prototype = root.ReaderUIV2?.ReaderV2Controller?.prototype;
        if (!prototype || prototype.__previewIncrementalChunkRenderingInstalled) return false;

        const originalLoadMore = prototype.loadMore;
        prototype.loadMore = async function previewIncrementalLoadMore(options = {}) {
            const canAppendIncrementally = Boolean(
                !options.replace
                && !options.deferRender
                && this.openResponse
                && this.presentationState?.mode === 'reflow'
            );
            if (!canAppendIncrementally) return originalLoadMore.call(this, options);

            const previousState = this.presentationState;
            const chunk = await originalLoadMore.call(this, { ...options, deferRender: true });
            if (!chunk || !this.openResponse) return chunk;

            this.activateReaderSurface?.();
            this.presentationState = this.presentation.presentationForDocument(
                this.openResponse,
                this.nodes,
                this.presentationOptions(),
            );
            renderIncrementalReflow(this, previousState);
            return chunk;
        };

        Object.defineProperty(prototype, '__previewIncrementalChunkRenderingInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        root.__TXT_PREVIEW_READER_INCREMENTAL_RENDER__ = Object.freeze({
            presentationPageSignature,
            renderIncrementalReflow,
        });
        return true;
    }

    function escapeNodeId(value) {
        if (root.CSS?.escape) return root.CSS.escape(String(value));
        return String(value).replace(/["\\]/g, '\\$&');
    }

    function yieldToBrowser() {
        if (typeof root.requestAnimationFrame === 'function') {
            return new Promise((resolve) => root.requestAnimationFrame(() => resolve()));
        }
        if (typeof root.setTimeout === 'function') {
            return new Promise((resolve) => root.setTimeout(resolve, 0));
        }
        return Promise.resolve();
    }

    function navigationButtons(controller) {
        const nav = controller?.element?.('readerV2Navigation');
        return Array.from(nav?.querySelectorAll?.('.reader-v2-nav-item') || []);
    }

    function navigationButtonFor(controller, nodeId) {
        const buttons = navigationButtons(controller);
        const byIdentity = buttons.find((button) => (
            String(button?.dataset?.readerNavNodeId || '') === String(nodeId || '')
        ));
        if (byIdentity) return byIdentity;
        const active = controller?.document?.activeElement;
        if (active && buttons.includes(active)) return active;
        return null;
    }

    function explicitNavigationGeneration(controller) {
        return Number(controller?.__previewExplicitNavigationGeneration || 0);
    }

    function markExplicitNavigation(controller, nodeId) {
        const generation = explicitNavigationGeneration(controller) + 1;
        controller.__previewExplicitNavigationGeneration = generation;
        controller.__previewExplicitNavigationNodeId = nodeId ? String(nodeId) : null;
        return generation;
    }

    function setNavigationBusy(controller, sourceButton, busy, loadedCount = 0) {
        if (!sourceButton) return;
        const buttons = navigationButtons(controller);
        if (!sourceButton.dataset.readerNavLabel) {
            sourceButton.dataset.readerNavLabel = String(sourceButton.textContent || '目标章节');
        }
        const label = sourceButton.dataset.readerNavLabel;
        if (busy) {
            buttons.forEach((button) => {
                if (button.dataset.readerNavWasDisabled === undefined) {
                    button.dataset.readerNavWasDisabled = button.disabled ? '1' : '0';
                }
                button.disabled = true;
            });
            sourceButton.setAttribute?.('aria-busy', 'true');
            sourceButton.dataset.readerNavLoading = '1';
            sourceButton.textContent = loadedCount > 0
                ? `⏳ ${label} · 已加载 ${loadedCount} 个内容块`
                : `⏳ ${label} · 正在定位…`;
            return;
        }

        sourceButton.removeAttribute?.('aria-busy');
        delete sourceButton.dataset.readerNavLoading;
        sourceButton.textContent = label;
        buttons.forEach((button) => {
            const wasDisabled = button.dataset.readerNavWasDisabled === '1';
            button.disabled = wasDisabled;
            delete button.dataset.readerNavWasDisabled;
        });
    }

    function installAsyncReaderNavigation() {
        const prototype = root.ReaderUIV2?.ReaderV2Controller?.prototype;
        if (!prototype || prototype.__previewAsyncNavigationInstalled) return false;

        const originalOpenBook = prototype.openBook;
        if (typeof originalOpenBook === 'function') {
            prototype.openBook = async function previewOpenBookWithResumeGuard(...args) {
                this.__previewResumeRestoreBaselineGeneration = explicitNavigationGeneration(this);
                return originalOpenBook.apply(this, args);
            };
        }

        if (typeof prototype.restoreResumeLocation === 'function') {
            prototype.restoreResumeLocation = async function previewRestoreResumeLocationGuarded() {
                const baseline = Number(
                    this.__previewResumeRestoreBaselineGeneration ?? explicitNavigationGeneration(this)
                );
                const stillCurrent = () => explicitNavigationGeneration(this) === baseline;
                if (!this.documentRef || !this.openResponse || !stillCurrent()) return null;

                const record = this.resumeStore?.read?.(this.documentRef);
                if (!record) return null;
                if (!this.resume?.sameCandidate?.(record, this.openResponse)) {
                    this.resumeStore?.clear?.(this.documentRef);
                    return null;
                }

                let node = this.model?.findNodeById?.(this.nodes, record.node_id) || null;
                while (!node && this.hasMore && stillCurrent()) {
                    await this.loadMore({ silent: true, deferRender: true });
                    if (!stillCurrent()) return null;
                    node = this.model?.findNodeById?.(this.nodes, record.node_id) || null;
                }

                if (!stillCurrent()) return null;
                if (!node) {
                    this.resumeStore?.clear?.(this.documentRef);
                    return null;
                }

                this.reflowAndRender?.();
                if (!stillCurrent()) return null;

                this.resumeRecord = record;
                const location = node.location || record;
                this.lastLocation = location;
                await this.navigateTo(location, { persist: false, behavior: 'auto', resumeRestore: true });
                if (!stillCurrent()) return null;
                this.setStatus?.('已恢复上次阅读位置。');
                return record;
            };
        }

        const originalRenderNavigation = prototype.renderNavigation;
        if (typeof originalRenderNavigation === 'function') {
            prototype.renderNavigation = function previewRenderNavigationWithIdentity(...args) {
                const result = originalRenderNavigation.apply(this, args);
                const buttons = navigationButtons(this);
                buttons.forEach((button, index) => {
                    const entry = this.navigation?.[index];
                    const nodeId = entry?.location?.node_id;
                    if (nodeId) button.dataset.readerNavNodeId = String(nodeId);
                    button.dataset.readerNavLabel = String(entry?.label || button.textContent || '未命名标题');
                    if (nodeId && button.dataset.previewExplicitNavigationBound !== '1') {
                        button.dataset.previewExplicitNavigationBound = '1';
                        button.addEventListener?.('click', () => {
                            markExplicitNavigation(this, nodeId);
                        }, { capture: true });
                    }
                });
                return result;
            };
        }

        prototype.navigateTo = async function previewNavigateTo(location, options = {}) {
            const nodeId = location?.node_id;
            if (!nodeId) return false;
            if (options.userInitiated === true) markExplicitNavigation(this, nodeId);
            const explicitGeneration = explicitNavigationGeneration(this);
            const syncExplicitPlayback = Boolean(
                !options.resumeRestore
                && String(this.__previewExplicitNavigationNodeId || '') === String(nodeId)
            );
            const selector = `[data-reader-node-id="${escapeNodeId(nodeId)}"]`;
            const findTarget = () => this.document?.querySelector?.(selector) || null;
            let nodeEl = findTarget();
            const sourceButton = options.sourceButton || navigationButtonFor(this, nodeId);

            this.__previewNavigationPending = true;
            try {
                if (!nodeEl && this.hasMore) {
                    this.setStatus?.('正在定位章节…');
                    setNavigationBusy(this, sourceButton, true, 0);
                    let node = this.model?.findNodeById?.(this.nodes, nodeId) || null;
                    while (!node && this.hasMore) {
                        await this.loadMore({ silent: true });
                        setNavigationBusy(this, sourceButton, true, Number(this.nodes?.length || 0));
                        await yieldToBrowser();
                        node = this.model?.findNodeById?.(this.nodes, nodeId) || null;
                    }
                    nodeEl = findTarget();
                }

                if (!nodeEl) {
                    this.setStatus?.('未能定位到该章节。', 'info');
                    return false;
                }

                nodeEl.scrollIntoView?.({ block: 'center', behavior: options.behavior || 'auto' });
                nodeEl.focus?.({ preventScroll: true });
                const resolved = this.locationForNode?.(nodeId) || location;
                this.lastLocation = resolved;
                if (options.persist !== false) this.persistLocation?.(resolved);
                if (syncExplicitPlayback && explicitNavigationGeneration(this) === explicitGeneration) {
                    await yieldToBrowser();
                    syncPlaybackCursorToReaderNode(this, nodeId);
                }
                if (
                    syncExplicitPlayback
                    && String(this.__previewExplicitNavigationNodeId || '') === String(nodeId)
                    && explicitNavigationGeneration(this) === explicitGeneration
                ) {
                    this.__previewExplicitNavigationNodeId = null;
                }
                this.setStatus?.('');
                return true;
            } catch (error) {
                this.renderError?.(error);
                return false;
            } finally {
                setNavigationBusy(this, sourceButton, false);
                this.__previewNavigationPending = false;
            }
        };

        Object.defineProperty(prototype, '__previewAsyncNavigationInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function installBoundedReaderAutoPagination() {
        const documentObject = root.document;
        if (!documentObject) return false;
        const main = documentObject.querySelector?.('.reader-v2-main');
        if (!main || main.dataset.previewAutoPaginationBound === '1') return false;

        main.dataset.previewAutoPaginationBound = '1';
        let pending = null;
        let candidateKey = null;
        let lastTriggerScrollTop = null;

        const nearLoadedEnd = () => {
            const remaining = Number(main.scrollHeight || 0)
                - Number(main.scrollTop || 0)
                - Number(main.clientHeight || 0);
            return remaining <= Math.max(AUTO_LOAD_THRESHOLD_PX, Number(main.clientHeight || 0) * 0.75);
        };

        const maybeLoadNextChunk = () => {
            const controller = root.ReaderUIV2?.getDefaultController?.();
            if (!controller?.openResponse || !controller.hasMore || controller.__previewNavigationPending) return null;

            const nextCandidateKey = String(controller.candidateId || controller.openResponse?.candidate_id || '');
            if (candidateKey !== nextCandidateKey) {
                candidateKey = nextCandidateKey;
                lastTriggerScrollTop = null;
            }

            if (!nearLoadedEnd() || pending) return pending;
            const scrollTop = Number(main.scrollTop || 0);
            if (
                lastTriggerScrollTop !== null
                && scrollTop < lastTriggerScrollTop + AUTO_LOAD_MIN_SCROLL_ADVANCE_PX
            ) {
                return null;
            }
            lastTriggerScrollTop = scrollTop;

            pending = Promise.resolve(controller.loadMore({ silent: true }))
                .catch((error) => controller.renderError?.(error))
                .finally(() => {
                    pending = null;
                });
            return pending;
        };

        main.addEventListener('scroll', maybeLoadNextChunk, { passive: true });
        root.__TXT_PREVIEW_READER_AUTOPAGINATION__ = Object.freeze({
            maybeLoadNextChunk,
            nearLoadedEnd,
        });
        return true;
    }

    function installPreviewReaderEnhancements() {
        installPlaybackBrowsingIsolation();
        installPlaybackBrowseTransportCapture();
        installIncrementalReaderChunkRendering();
        installAsyncReaderNavigation();
        installBoundedReaderAutoPagination();
    }

    if (root.document) {
        if (root.document.readyState === 'loading') {
            root.document.addEventListener('DOMContentLoaded', installPreviewReaderEnhancements, { once: true });
        } else {
            installPreviewReaderEnhancements();
        }
    }

    root.console?.info?.('[preview] frontend connected to HF test backend', root.SPEED_READING_CONFIG);
})(typeof window !== 'undefined' ? window : globalThis);
