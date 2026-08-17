(function (root) {
    'use strict';

    const PREVIEW_PATH_PATTERN = /\/preview\/(?:staging-)?pr-\d+(?:\/|$)/;
    const STAGING_PATH_PATTERN = /\/staging(?:\/|$)/;
    const pathname = String(root.location?.pathname || '');
    const isPreview = PREVIEW_PATH_PATTERN.test(pathname);
    const isStaging = STAGING_PATH_PATTERN.test(pathname);

    const PRODUCTION_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service.hf.space';
    const STAGING_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service-staging.hf.space';

    if (isPreview || isStaging) {
        const environment = isStaging ? 'staging' : 'staging-preview';
        root.SPEED_READING_CONFIG = Object.freeze({
            environment,
            frontendBranch: 'staging',
            backendBranch: 'staging',
            apiBaseUrl: STAGING_API_BASE_URL,
        });
        root.READER_API_BASE_URL = STAGING_API_BASE_URL;
        root.API_BASE_URL_OVERRIDE = STAGING_API_BASE_URL;
        root.APP_ACCESS_AUTH_BASE_URL = STAGING_API_BASE_URL;

        function rewriteUrl(value) {
            const url = String(value || '');
            return url.startsWith(PRODUCTION_API_BASE_URL)
                ? `${STAGING_API_BASE_URL}${url.slice(PRODUCTION_API_BASE_URL.length)}`
                : url;
        }

        const nativeFetch = root.fetch && root.fetch.bind(root);
        if (!nativeFetch) throw new Error('Staging runtime requires window.fetch');

        // AppAccess consumes this one-shot raw fetch for the shared login only.
        // Staging owns both the auth endpoint and the application endpoints; the
        // raw fetch bypasses URL rewriting but APP_ACCESS_AUTH_BASE_URL keeps the
        // login request on the Staging backend.
        root.__APP_ACCESS_AUTH_FETCH__ = nativeFetch;

        root.fetch = function stagingFetch(input, init) {
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
            stagingApiBaseUrl: STAGING_API_BASE_URL,
            rewriteUrl,
        });
        root.console?.info?.('[staging] frontend connected to HF staging backend', root.SPEED_READING_CONFIG);
    } else {
        root.console?.info?.('[staging] runtime skipped outside Staging/PR preview routes', { pathname });
    }

    // This file is the first application script in index.html. Load the access
    // bootstrap synchronously so it captures Staging's fetch rewrite first. The
    // resumable adapter then wraps the authenticated fetch only for large staging
    // uploads, before the normal bookshelf upload lifecycle is registered.
    if (root.document && typeof root.document.write === 'function') {
        root.document.write(
            '<script src="app-access.js"><\/script>'
            + '<script src="bookshelf-resumable-upload.js"><\/script>'
            + '<script src="bookshelf-upload-lifecycle.js"><\/script>',
        );
    }
})(typeof window !== 'undefined' ? window : globalThis);
