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

    function previewHeadVersion(documentObject = root.document) {
        return String(documentObject?.querySelector?.('meta[name="reader-preview-head"]')?.getAttribute?.('content') || '').trim();
    }

    function loadBoundaryNavigation() {
        const documentObject = root.document;
        if (!documentObject || root.ReaderBoundaryNavigation) {
            root.ReaderBoundaryNavigation?.installWithRetry?.(root);
            return;
        }
        const script = documentObject.createElement('script');
        const version = previewHeadVersion(documentObject);
        script.src = `reader-boundary-navigation.js${version ? `?v=${encodeURIComponent(version)}` : ''}`;
        script.dataset.readerEnhancement = 'reader-boundary-navigation.js';
        script.addEventListener('load', () => root.ReaderBoundaryNavigation?.installWithRetry?.(root), { once: true });
        script.addEventListener('error', () => root.console?.error?.('[preview] failed to load reader-boundary-navigation.js'), { once: true });
        documentObject.head.appendChild(script);
    }

    if (root.document?.readyState === 'loading') {
        root.document.addEventListener('DOMContentLoaded', loadBoundaryNavigation, { once: true });
    } else {
        loadBoundaryNavigation();
    }

    root.__TXT_PREVIEW_ROUTING__ = Object.freeze({
        productionApiBaseUrl: PRODUCTION_API_BASE_URL,
        testApiBaseUrl: TEST_API_BASE_URL,
        rewriteUrl,
    });
    root.console?.info?.('[preview] frontend connected to HF test backend', root.SPEED_READING_CONFIG);
})(typeof window !== 'undefined' ? window : globalThis);