(function (root) {
    'use strict';

    const PRODUCTION_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service.hf.space';
    const TEST_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service-ocrmypdf-test.hf.space';

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

    console.info('[preview] frontend connected to test backend', root.SPEED_READING_CONFIG);
})(typeof window !== 'undefined' ? window : globalThis);
