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
    const runtimeScriptUrl = root.document?.currentScript?.src || root.location?.href || '';
    const runtimeBaseUrl = runtimeScriptUrl ? new URL('.', runtimeScriptUrl) : null;

    const state = {
        environment: 'preview',
        frontendBranch: 'preview',
        backendBranch: 'deploy/ocrmypdf-test',
        apiBaseUrl: TEST_API_BASE_URL,
        activeBookId: null,
        finalResult: null,
        finalResultReceivedAt: null,
    };

    root.SPEED_READING_CONFIG = Object.freeze({
        environment: state.environment,
        frontendBranch: state.frontendBranch,
        backendBranch: state.backendBranch,
        apiBaseUrl: TEST_API_BASE_URL,
    });
    root.READER_API_BASE_URL = TEST_API_BASE_URL;
    root.API_BASE_URL_OVERRIDE = TEST_API_BASE_URL;
    root.previewProcessing = state;

    function rewriteUrl(value) {
        const url = String(value || '');
        return url.startsWith(PRODUCTION_API_BASE_URL)
            ? `${TEST_API_BASE_URL}${url.slice(PRODUCTION_API_BASE_URL.length)}`
            : url;
    }

    function readerDocumentRefFromUrl(value) {
        try {
            const url = new URL(String(value), root.location && root.location.href);
            if (url.origin !== new URL(TEST_API_BASE_URL).origin) return null;
            const match = url.pathname.match(/^\/api\/reader\/v2\/documents\/([^/]+)$/);
            return match ? decodeURIComponent(match[1]) : null;
        } catch (error) {
            return null;
        }
    }

    function publishFinalResult(documentRef, payload) {
        state.activeBookId = documentRef;
        state.finalResult = payload;
        state.finalResultReceivedAt = new Date().toISOString();
        root.dispatchEvent(new CustomEvent('book-processing-completed', {
            detail: {
                bookId: documentRef,
                documentRef,
                result: payload,
                receivedAt: state.finalResultReceivedAt,
                environment: state.environment,
                apiBaseUrl: state.apiBaseUrl,
            },
        }));
    }

    function previewAssetUrl(filename) {
        return runtimeBaseUrl ? new URL(filename, runtimeBaseUrl).href : filename;
    }

    function ensureStylesheet(filename) {
        const documentObject = root.document;
        if (!documentObject?.head) return null;
        const href = previewAssetUrl(filename);
        const existing = Array.from(documentObject.querySelectorAll('link[rel="stylesheet"]'))
            .find((link) => link.href === href || link.getAttribute('href') === filename);
        if (existing) return existing;
        const link = documentObject.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.previewPresentationSourceRendering = 'true';
        documentObject.head.appendChild(link);
        return link;
    }

    function loadScript(filename, ready) {
        if (typeof ready === 'function' && ready()) return Promise.resolve();
        const documentObject = root.document;
        if (!documentObject?.head) return Promise.reject(new Error('Preview document head is unavailable'));
        const src = previewAssetUrl(filename);
        const existing = Array.from(documentObject.scripts || [])
            .find((script) => script.src === src || script.getAttribute('src') === filename);
        if (existing) {
            if (typeof ready === 'function' && ready()) return Promise.resolve();
            return new Promise((resolve, reject) => {
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', reject, { once: true });
            });
        }
        return new Promise((resolve, reject) => {
            const script = documentObject.createElement('script');
            script.src = src;
            script.async = false;
            script.dataset.previewPresentationSourceRendering = 'true';
            script.addEventListener('load', resolve, { once: true });
            script.addEventListener('error', () => reject(new Error(`Could not load ${filename}`)), { once: true });
            documentObject.head.appendChild(script);
        });
    }

    async function installPresentationSourceRendering() {
        ensureStylesheet('reader-presentation-source-rendering.css');
        await loadScript('reader-semantic-page.js', () => Boolean(root.ReaderSemanticPageV2));
        await loadScript(
            'reader-semantic-page-integration.js',
            () => Boolean(root.ReaderSemanticPageIntegrationV2),
        );
        await loadScript(
            'reader-presentation-source-rendering.js',
            () => Boolean(root.ReaderPresentationSourceRenderingV2),
        );
        root.ReaderPresentationSourceRenderingV2?.install?.(root);
    }

    const nativeFetch = root.fetch && root.fetch.bind(root);
    if (!nativeFetch) throw new Error('Preview runtime requires window.fetch');

    root.fetch = async function previewFetch(input, init) {
        let requestInput = input;
        let observedUrl = '';

        if (typeof input === 'string' || input instanceof URL) {
            observedUrl = rewriteUrl(input);
            requestInput = observedUrl;
        } else if (typeof Request !== 'undefined' && input instanceof Request) {
            observedUrl = rewriteUrl(input.url);
            requestInput = observedUrl === input.url ? input : new Request(observedUrl, input);
        } else {
            observedUrl = String(input || '');
        }

        const response = await nativeFetch(requestInput, init);
        const documentRef = readerDocumentRefFromUrl(observedUrl || response.url);
        if (documentRef && response.ok) {
            response.clone().json()
                .then((payload) => publishFinalResult(documentRef, payload))
                .catch((error) => console.warn('Preview final result could not be decoded.', error));
        }
        return response;
    };

    if (root.document) {
        ensureStylesheet('reader-presentation-source-rendering.css');
        root.addEventListener('load', () => {
            installPresentationSourceRendering().catch((error) => {
                console.warn('[preview] presentation source rendering could not be installed', error);
            });
        }, { once: true });
    }

    console.info('[preview] frontend connected to test backend', root.SPEED_READING_CONFIG);
})(typeof window !== 'undefined' ? window : globalThis);
