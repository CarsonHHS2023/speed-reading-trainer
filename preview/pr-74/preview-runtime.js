(function (root) {
    'use strict';

    const PREVIEW_PATH_PATTERN = /\/preview\/pr-\d+(?:\/|$)/;
    const pathname = String(root.location?.pathname || '');
    const isPreview = PREVIEW_PATH_PATTERN.test(pathname);

    const PRODUCTION_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service.hf.space';
    const TEST_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service-ocrmypdf-test.hf.space';

    if (isPreview) {
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

        // AppAccess consumes this one-shot raw fetch for the shared login only.
        // Normal application fetches remain behind the Preview URL rewrite below.
        root.__APP_ACCESS_AUTH_FETCH__ = nativeFetch;

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

        root.__TXT_PREVIEW_ROUTING__ = Object.freeze({
            productionApiBaseUrl: PRODUCTION_API_BASE_URL,
            testApiBaseUrl: TEST_API_BASE_URL,
            rewriteUrl,
        });
        root.console?.info?.('[preview] frontend connected to HF test backend', root.SPEED_READING_CONFIG);
    } else {
        root.console?.info?.('[preview] runtime skipped outside PR preview', { pathname });
    }

    // This file is the first application script in index.html. Load the access
    // bootstrap synchronously here so it captures Preview's fetch rewrite first
    // and is still installed before Reader/Bookshelf scripts register requests.
    if (root.document && typeof root.document.write === 'function') {
        root.document.write('<script src="app-access.js"><\/script>');
    }
})(typeof window !== 'undefined' ? window : globalThis);