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

    function installAsyncReaderNavigation() {
        const prototype = root.ReaderUIV2?.ReaderV2Controller?.prototype;
        if (!prototype || prototype.__previewAsyncNavigationInstalled) return false;

        prototype.navigateTo = async function previewNavigateTo(location, options = {}) {
            const nodeId = location?.node_id;
            if (!nodeId) return false;
            const selector = `[data-reader-node-id="${escapeNodeId(nodeId)}"]`;
            const findTarget = () => this.document?.querySelector?.(selector) || null;
            let nodeEl = findTarget();

            this.__previewNavigationPending = true;
            try {
                if (!nodeEl && this.hasMore) {
                    this.setStatus?.('正在定位章节…');
                    let node = this.model?.findNodeById?.(this.nodes, nodeId) || null;
                    while (!node && this.hasMore) {
                        await this.loadMore({ silent: true });
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
                this.setStatus?.('');
                return true;
            } catch (error) {
                this.renderError?.(error);
                return false;
            } finally {
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
