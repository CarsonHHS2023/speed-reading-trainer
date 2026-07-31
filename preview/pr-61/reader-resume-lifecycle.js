(function (root) {
    'use strict';

    const ASSET_VERSION = '2026-07-30-phase24c5e';
    const DEFAULT_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service.hf.space';
    const BOOKSHELF_CACHE_KEY = 'reader-v2-bookshelf-cache-v1';

    function versionedAsset(src) {
        const separator = String(src).includes('?') ? '&' : '?';
        return `${src}${separator}v=${encodeURIComponent(ASSET_VERSION)}`;
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

    function installBookshelfResilience(prototype, options = {}) {
        if (!prototype || prototype.__bookshelfResilienceInstalled) return Boolean(prototype);
        const fetchImpl = options.fetchImpl
            || (typeof root?.fetch === 'function' ? root.fetch.bind(root) : null);
        const storage = options.storage || root?.localStorage;
        const resolveBaseUrl = options.resolveBaseUrl || (() => resolveBookshelfBaseUrl(root));

        prototype.loadBooksFromBackend = async function loadBooksFromBackendResilient() {
            this.setLoading(true, '⏳ 正在加载书架...');
            try {
                if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
                const response = await fetchImpl(`${resolveBaseUrl()}/api/v1/books`);
                if (!response?.ok) throw new Error(`HTTP ${response?.status || 0}`);

                const result = await response.json();
                const books = Array.isArray(result?.books) ? result.books : [];
                this.books = books
                    .filter((book) => book?.status !== 'processing')
                    .map((book) => this.normalizeBook(book));

                writeCachedBooks(this.books, storage);
                this.ensureCategoryIntegrity();
                this.renderCategories();
                this.renderBooks();
                this.setLoading(false);
                return this.books;
            } catch (error) {
                console.error('加载书籍失败:', error);
                const cachedBooks = readCachedBooks(storage);
                if ((!Array.isArray(this.books) || this.books.length === 0) && cachedBooks.length) {
                    this.books = cachedBooks.map((book) => this.normalizeBook(book));
                }
                this.ensureCategoryIntegrity();
                this.renderCategories();
                this.renderBooks();
                this.setLoading(
                    false,
                    this.books.length
                        ? '⚠️ 书架服务暂时不可用<br><span>正在显示最近书单</span>'
                        : '⚠️ 无法连接书架服务<br><span>请稍后刷新</span>',
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
            .then(() => loadScript('reader-fragment-join-policy.js', 'ReaderFragmentJoinPolicy'))
            .then((module) => module?.install?.(root))
            .then(() => loadScript('speed-reading-responsive-layout.js', 'SpeedReadingResponsiveLayout'))
            .then((module) => module?.install?.(root))
            .then(() => loadScript('reader-punctuation-hanging-policy.js', 'ReaderPunctuationHangingPolicy'))
            .then((module) => module?.install?.(root))
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
        DEFAULT_API_BASE_URL,
        install,
        installBookshelfResilience,
        installEnhancements,
        loadScript,
        normalizeBaseUrl,
        readCachedBooks,
        refreshStylesheet,
        resolveBookshelfBaseUrl,
        versionedAsset,
        writeCachedBooks,
    };
    if (typeof module === 'object' && module.exports) module.exports = exported;
    if (root) root.ReaderResumeLifecycleV2 = exported;
})(typeof globalThis !== 'undefined' ? globalThis : this);
