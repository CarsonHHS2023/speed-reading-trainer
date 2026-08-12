(function (root) {
    'use strict';

    const ASSET_VERSION = '2026-07-31-bookshelf-diagnostics';
    const DEFAULT_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service.hf.space';
    const BOOKSHELF_CACHE_KEY = 'reader-v2-bookshelf-cache-v1';

    class BookshelfEndpointError extends Error {
        constructor(message, options = {}) {
            super(message);
            this.name = 'BookshelfEndpointError';
            this.kind = options.kind || 'unknown';
            this.status = Number(options.status || 0);
            this.url = String(options.url || '');
            this.cause = options.cause;
        }
    }

    function previewHeadVersion(documentObject = typeof document !== 'undefined' ? document : null) {
        return String(
            documentObject?.querySelector?.('meta[name="reader-preview-head"]')?.getAttribute?.('content') || '',
        ).trim();
    }

    function currentScriptAssetVersion(documentObject = typeof document !== 'undefined' ? document : null) {
        const src = String(documentObject?.currentScript?.src || '').trim();
        if (!src) return '';
        try {
            return new URL(src, documentObject?.baseURI || root?.location?.href || undefined).searchParams.get('v') || '';
        } catch (_error) {
            const match = src.match(/[?&]v=([^&#]+)/u);
            return match ? decodeURIComponent(match[1]) : '';
        }
    }

    // document.currentScript is only reliable while this entrypoint is executing.
    // Capture its deployment SHA now so later Promise-chain loads inherit the same
    // production/Preview asset version even after currentScript becomes null.
    const ENTRYPOINT_ASSET_VERSION = currentScriptAssetVersion(
        typeof document !== 'undefined' ? document : null,
    );

    function assetVersion(documentObject = typeof document !== 'undefined' ? document : null) {
        return previewHeadVersion(documentObject)
            || currentScriptAssetVersion(documentObject)
            || ENTRYPOINT_ASSET_VERSION
            || ASSET_VERSION;
    }

    function versionedAsset(src, documentObject = typeof document !== 'undefined' ? document : null) {
        const separator = String(src).includes('?') ? '&' : '?';
        return `${src}${separator}v=${encodeURIComponent(assetVersion(documentObject))}`;
    }

    function refreshStylesheet() {
        if (typeof document === 'undefined') return;
        const link = document.getElementById('speedReadingV2Styles');
        if (link) link.href = versionedAsset('speed-reading-v2.css');
    }

    function loadScript(src, globalName) {
        if (globalName && root[globalName]) return Promise.resolve(root[globalName]);
        if (typeof document === 'undefined') return Promise.resolve(null);
        const existing = document.querySelector(`script[data-reader-enhancement="${src}"]`);
        if (existing) return new Promise((resolve) => {
            if (existing.dataset.loaded === '1') resolve(globalName ? root[globalName] : true);
            else existing.addEventListener('load', () => resolve(globalName ? root[globalName] : true), { once: true });
        });
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = versionedAsset(src);
            script.dataset.readerEnhancement = src;
            script.addEventListener('load', () => {
                script.dataset.loaded = '1';
                resolve(globalName ? root[globalName] : true);
            }, { once: true });
            script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
            document.head.appendChild(script);
        });
    }

    function normalizeBaseUrl(value) {
        return String(value || '').replace(/\/+$/, '');
    }

    function resolveBookshelfBaseUrl(rootObject = root) {
        const readerResolver = rootObject?.ReaderApiV2?.resolveBaseUrl;
        if (typeof readerResolver === 'function') {
            return normalizeBaseUrl(readerResolver(rootObject));
        }
        const configured = rootObject && (
            rootObject.READER_API_BASE_URL
            || rootObject.API_BASE_URL_OVERRIDE
            || rootObject.API_BASE_URL
        );
        return normalizeBaseUrl(configured || DEFAULT_API_BASE_URL);
    }

    function readCachedBooks(storage = root?.localStorage) {
        if (!storage || typeof storage.getItem !== 'function') return [];
        try {
            const parsed = JSON.parse(storage.getItem(BOOKSHELF_CACHE_KEY) || '[]');
            return Array.isArray(parsed) ? parsed.filter((book) => book && typeof book === 'object') : [];
        } catch (error) {
            console.warn('[Bookshelf cache] unable to read cached books', error);
            return [];
        }
    }

    function writeCachedBooks(books, storage = root?.localStorage) {
        if (!storage || typeof storage.setItem !== 'function') return false;
        try {
            storage.setItem(BOOKSHELF_CACHE_KEY, JSON.stringify(Array.isArray(books) ? books : []));
            return true;
        } catch (error) {
            console.warn('[Bookshelf cache] unable to store books', error);
            return false;
        }
    }

    async function fetchResponse(fetchImpl, url) {
        try {
            return await fetchImpl(url, {
                cache: 'no-store',
                headers: { Accept: 'application/json' },
            });
        } catch (error) {
            throw new BookshelfEndpointError('Network or CORS request failed', {
                kind: 'network_or_cors',
                url,
                cause: error,
            });
        }
    }

    async function fetchBooksPayload(fetchImpl, url) {
        const response = await fetchResponse(fetchImpl, url);
        if (!response?.ok) {
            throw new BookshelfEndpointError(`HTTP ${response?.status || 0}`, {
                kind: 'http',
                status: response?.status || 0,
                url,
            });
        }
        try {
            return await response.json();
        } catch (error) {
            throw new BookshelfEndpointError('Invalid JSON response', {
                kind: 'invalid_json',
                status: response?.status || 0,
                url,
                cause: error,
            });
        }
    }

    function endpointDiagnosticFromError(error, url) {
        if (error instanceof BookshelfEndpointError) {
            return {
                url: error.url || url,
                ok: false,
                kind: error.kind,
                status: error.status || 0,
                error_name: error.cause?.name || error.name,
            };
        }
        return {
            url,
            ok: false,
            kind: 'unknown',
            status: 0,
            error_name: error?.name || 'Error',
        };
    }

    async function probeEndpoint(fetchImpl, url) {
        try {
            const response = await fetchResponse(fetchImpl, url);
            return {
                url,
                ok: Boolean(response?.ok),
                kind: 'http',
                status: Number(response?.status || 0),
                error_name: null,
            };
        } catch (error) {
            return endpointDiagnosticFromError(error, url);
        }
    }

    function endpointDiagnosticLabel(result) {
        if (!result) return 'UNKNOWN';
        if (result.kind === 'network_or_cors') return 'NETWORK/CORS';
        if (result.kind === 'invalid_json') return `INVALID JSON${result.status ? ` (${result.status})` : ''}`;
        if (result.status) return `HTTP ${result.status}`;
        return String(result.kind || 'UNKNOWN').toUpperCase();
    }

    async function diagnoseBookshelfFailure(fetchImpl, baseUrl, booksError) {
        const booksUrl = `${baseUrl}/api/v1/books`;
        const healthUrl = `${baseUrl}/api/v1/health`;
        const diagnostics = {
            checked_at: new Date().toISOString(),
            base_url: baseUrl,
            books: endpointDiagnosticFromError(booksError, booksUrl),
            health: await probeEndpoint(fetchImpl, healthUrl),
        };
        diagnostics.summary = (
            `books=${endpointDiagnosticLabel(diagnostics.books)} · `
            + `health=${endpointDiagnosticLabel(diagnostics.health)}`
        );
        return diagnostics;
    }

    function installBookshelfResilience(prototype, options = {}) {
        if (!prototype || prototype.__bookshelfResilienceInstalled) return Boolean(prototype);
        const fetchImpl = options.fetchImpl
            || (typeof root?.fetch === 'function' ? root.fetch.bind(root) : null);
        const storage = options.storage || root?.localStorage;
        const resolveBaseUrl = options.resolveBaseUrl || (() => resolveBookshelfBaseUrl(root));

        prototype.loadBooksFromBackend = async function loadBooksFromBackendResilient() {
            this.setLoading(true, '⏳ 正在加载书架...');
            const baseUrl = resolveBaseUrl();
            const booksUrl = `${baseUrl}/api/v1/books`;
            try {
                if (typeof fetchImpl !== 'function') {
                    throw new BookshelfEndpointError('fetch is unavailable', {
                        kind: 'fetch_unavailable',
                        url: booksUrl,
                    });
                }
                const result = await fetchBooksPayload(fetchImpl, booksUrl);
                const books = Array.isArray(result?.books) ? result.books : [];
                this.books = books
                    .filter((book) => book?.status !== 'processing')
                    .map((book) => this.normalizeBook(book));

                writeCachedBooks(this.books, storage);
                this.bookshelfConnectionDiagnostics = {
                    checked_at: new Date().toISOString(),
                    base_url: baseUrl,
                    books: { url: booksUrl, ok: true, kind: 'http', status: 200 },
                    health: null,
                    summary: 'books=HTTP 200',
                };
                if (root) root.__BOOKSHELF_CONNECTION_DIAGNOSTICS__ = this.bookshelfConnectionDiagnostics;
                this.ensureCategoryIntegrity();
                this.renderCategories();
                this.renderBooks();
                this.setLoading(false);
                return this.books;
            } catch (error) {
                const diagnostics = await diagnoseBookshelfFailure(fetchImpl, baseUrl, error);
                this.bookshelfConnectionDiagnostics = diagnostics;
                if (root) root.__BOOKSHELF_CONNECTION_DIAGNOSTICS__ = diagnostics;
                console.error('[Bookshelf connection diagnostics]', diagnostics, error);

                const cachedBooks = readCachedBooks(storage);
                if ((!Array.isArray(this.books) || this.books.length === 0) && cachedBooks.length) {
                    this.books = cachedBooks.map((book) => this.normalizeBook(book));
                }
                this.ensureCategoryIntegrity();
                this.renderCategories();
                this.renderBooks();
                const cachePrefix = this.books.length ? '正在显示最近书单 · ' : '';
                this.setLoading(
                    false,
                    `⚠️ 书架服务不可用<br><span>${cachePrefix}${diagnostics.summary}</span>`,
                );
                return this.books;
            }
        };

        Object.defineProperty(prototype, '__bookshelfResilienceInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function installEnhancements() {
        refreshStylesheet();
        return loadScript('speed-reading-structure-policy.js', 'SpeedReadingStructurePolicy')
            .then((module) => module?.install?.(root))
            .then(() => root.SpeedReadingAdapter?.installPlaybackRenderer?.(root))
            .then(() => loadScript('reader-fragment-join-policy.js', 'ReaderFragmentJoinPolicy'))
            .then((module) => module?.install?.(root))
            .then(() => loadScript('speed-reading-responsive-layout.js', 'SpeedReadingResponsiveLayout'))
            .then((module) => module?.install?.(root))
            .then(() => loadScript('reader-punctuation-hanging-policy.js', 'ReaderPunctuationHangingPolicy'))
            .then((module) => module?.install?.(root))
            .then(() => loadScript('speed-reading-formula-rendering.js', 'SpeedReadingFormulaRendering'))
            .then((module) => module?.installWithRetry?.(root) ?? module?.install?.(root))
            .then(() => loadScript('speed-reading-layout-integrity.js', 'SpeedReadingLayoutIntegrity'))
            .then((module) => module?.installWithRetry?.(root) ?? module?.install?.(root))
            .then(() => loadScript('speed-reading-block-layout-policy.js', 'SpeedReadingBlockLayoutPolicy'))
            .then((module) => module?.installWithRetry?.(root) ?? module?.install?.(root))
            .then(() => loadScript('speed-reading-speed-policy.js', 'SpeedReadingSpeedPolicy'))
            .then((module) => module?.installWithRetry?.(root) ?? module?.install?.(root))
            .then(() => loadScript('reader-playback-polish.js', 'ReaderPlaybackPolish'))
            .then((module) => module?.install?.(root))
            .then(() => loadScript('reader-study-tools-rail.js', 'ReaderStudyToolsRail'))
            .then((module) => module?.install?.())
            .catch((error) => console.error('[Reader enhancements]', error));
    }

    function install() {
        if (typeof BookShelf === 'undefined' || !BookShelf.prototype) return false;
        const prototype = BookShelf.prototype;
        installBookshelfResilience(prototype);
        if (prototype.__readerV2ResumeLifecycleInstalled) return true;
        prototype.__readerV2ResumeLifecycleInstalled = true;

        const originalDeleteBook = prototype.deleteBook;
        if (typeof originalDeleteBook === 'function') {
            prototype.deleteBook = async function deleteBookWithReaderV2LocalCleanup(bookId) {
                await originalDeleteBook.call(this, bookId);
                const stillExists = (this.books || []).some((book) => String(book.id) === String(bookId));
                if (!stillExists) {
                    root.ReaderUIV2?.getDefaultController?.().clearResume?.(bookId);
                    root.ReaderAnnotationsUIV2?.getDefaultController?.().clearDocument?.(bookId);
                    root.ReaderHighlightsUIV2?.getDefaultController?.().clearDocument?.(bookId);
                    writeCachedBooks(this.books, root?.localStorage);
                }
            };
        }
        installEnhancements();
        return true;
    }

    install();

    const exported = {
        ASSET_VERSION,
        BOOKSHELF_CACHE_KEY,
        BookshelfEndpointError,
        DEFAULT_API_BASE_URL,
        ENTRYPOINT_ASSET_VERSION,
        assetVersion,
        currentScriptAssetVersion,
        diagnoseBookshelfFailure,
        endpointDiagnosticFromError,
        endpointDiagnosticLabel,
        fetchBooksPayload,
        fetchResponse,
        install,
        installBookshelfResilience,
        installEnhancements,
        loadScript,
        normalizeBaseUrl,
        previewHeadVersion,
        probeEndpoint,
        readCachedBooks,
        refreshStylesheet,
        resolveBookshelfBaseUrl,
        versionedAsset,
        writeCachedBooks,
    };
    if (typeof module === 'object' && module.exports) module.exports = exported;
    if (root) root.ReaderResumeLifecycleV2 = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);