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

    function installBoundedReaderAutoPagination() {
        const documentObject = root.document;
        if (!documentObject) return false;
        const main = documentObject.querySelector?.('.reader-v2-main');
        if (!main || main.dataset.previewAutoPaginationBound === '1') return false;

        main.dataset.previewAutoPaginationBound = '1';
        let pending = null;

        const nearLoadedEnd = () => {
            const remaining = Number(main.scrollHeight || 0)
                - Number(main.scrollTop || 0)
                - Number(main.clientHeight || 0);
            return remaining <= Math.max(AUTO_LOAD_THRESHOLD_PX, Number(main.clientHeight || 0) * 0.75);
        };

        const maybeLoadNextChunk = () => {
            if (!nearLoadedEnd() || pending) return pending;
            const controller = root.ReaderUIV2?.getDefaultController?.();
            if (!controller?.openResponse || !controller.hasMore) return null;

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

    if (root.document) {
        if (root.document.readyState === 'loading') {
            root.document.addEventListener('DOMContentLoaded', installBoundedReaderAutoPagination, { once: true });
        } else {
            installBoundedReaderAutoPagination();
        }
    }

    root.console?.info?.('[preview] frontend connected to HF test backend', root.SPEED_READING_CONFIG);
})(typeof window !== 'undefined' ? window : globalThis);
