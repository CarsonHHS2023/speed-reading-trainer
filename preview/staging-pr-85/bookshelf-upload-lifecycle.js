(function (root, factory) {
    const api = factory(root || (typeof globalThis !== 'undefined' ? globalThis : null));
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.BookshelfUploadLifecycle = api;
        if (root.document?.addEventListener) {
            root.document.addEventListener('DOMContentLoaded', () => api.install(root), { once: true });
        }
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    const DEFAULT_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service.hf.space';
    const BOOKSHELF_CACHE_KEY = 'reader-v2-bookshelf-cache-v1';
    const POLL_INTERVAL_MS = 5000;
    const MAX_CONSECUTIVE_POLL_FAILURES = 12;

    function normalizeBaseUrl(value) {
        return String(value || '').replace(/\/+$/, '');
    }

    function resolveApiBaseUrl(rootObject = root) {
        return normalizeBaseUrl(
            rootObject?.READER_API_BASE_URL
            || rootObject?.API_BASE_URL_OVERRIDE
            || rootObject?.API_BASE_URL
            || rootObject?.SPEED_READING_CONFIG?.apiBaseUrl
            || DEFAULT_API_BASE_URL,
        );
    }

    function defaultWriteCachedBooks(books, storage = root?.localStorage) {
        if (!storage || typeof storage.setItem !== 'function') return false;
        try {
            storage.setItem(BOOKSHELF_CACHE_KEY, JSON.stringify(Array.isArray(books) ? books : []));
            return true;
        } catch (error) {
            root?.console?.warn?.('[Bookshelf upload cache] unable to store books', error);
            return false;
        }
    }

    function isTransientStatus(status) {
        const numeric = Number(status || 0);
        return numeric === 408 || numeric === 429 || numeric >= 500;
    }

    function makePollingResult(bookId, status, errorMessage, errorCode) {
        return {
            book_id: bookId,
            status,
            error_message: errorMessage,
            error_code: errorCode,
        };
    }

    function createBookStatusPoller(options = {}) {
        const intervalMs = Number.isFinite(options.intervalMs)
            ? Math.max(0, Number(options.intervalMs))
            : POLL_INTERVAL_MS;
        const maxConsecutiveFailures = Number.isFinite(options.maxConsecutiveFailures)
            ? Math.max(1, Number(options.maxConsecutiveFailures))
            : MAX_CONSECUTIVE_POLL_FAILURES;

        return async function pollBookStatus(bookId, bookName, totalPages) {
            const rootObject = options.rootObject || root;
            const documentObject = options.documentObject || rootObject?.document;
            const fetchImpl = options.fetchImpl || rootObject?.fetch?.bind(rootObject);
            const setTimeoutImpl = options.setTimeoutImpl || rootObject?.setTimeout?.bind(rootObject) || setTimeout;
            const consoleObject = options.consoleObject || rootObject?.console || console;
            const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl || resolveApiBaseUrl(rootObject));

            const panel = documentObject?.getElementById?.('processingPanel');
            const nameEl = documentObject?.getElementById?.('processingBookName');
            const statusEl = documentObject?.getElementById?.('processingStatus');
            const percentEl = documentObject?.getElementById?.('processingPercent');
            const fill = documentObject?.getElementById?.('processingBarFill');
            const info = documentObject?.getElementById?.('processingPageInfo');

            if (!fetchImpl) {
                return makePollingResult(bookId, 'polling_unavailable', '状态查询服务不可用', 'fetch_unavailable');
            }
            if (!panel || !nameEl || !statusEl || !percentEl || !fill || !info) {
                return makePollingResult(bookId, 'failed', '处理进度面板未初始化', 'progress_ui_unavailable');
            }

            const updateProgressUi = (statusText, progressValue, pageText, failed = false) => {
                nameEl.textContent = bookName;
                statusEl.textContent = statusText;
                info.textContent = pageText || (totalPages ? `共 ${totalPages} 页` : '');
                panel.style.display = 'block';

                if (typeof progressValue === 'number') {
                    fill.className = 'processing-bar-fill';
                    fill.style.width = `${Math.max(0, Math.min(progressValue, 100))}%`;
                    percentEl.textContent = `${Math.round(progressValue)}%`;
                } else {
                    fill.className = 'processing-bar-fill indeterminate';
                    fill.style.width = '0%';
                    percentEl.textContent = '处理中…';
                }

                fill.style.background = failed ? '#e53935' : '';
                if (failed) percentEl.textContent = '失败';
            };

            updateProgressUi('处理中…', null, totalPages ? `共 ${totalPages} 页` : '');

            return new Promise((resolve) => {
                let consecutiveFailures = 0;
                let settled = false;

                const finish = (result, statusText, detail, terminal = {}) => {
                    if (settled) return;
                    settled = true;
                    const isFailed = terminal.kind === 'failed';
                    updateProgressUi(statusText, isFailed ? 100 : null, detail || result.error_message || '', isFailed);
                    if (!isFailed && terminal.label) percentEl.textContent = terminal.label;
                    resolve(result);
                };

                const schedule = () => {
                    if (!settled) setTimeoutImpl(tick, intervalMs);
                };

                const handleTransientFailure = (message, error) => {
                    consecutiveFailures += 1;
                    consoleObject?.error?.('轮询状态失败:', error || message);
                    if (consecutiveFailures >= maxConsecutiveFailures) {
                        finish(
                            makePollingResult(
                                bookId,
                                'polling_unavailable',
                                '书籍仍可能在后台处理中；状态查询暂时不可用，请稍后刷新书架。',
                                'polling_retry_exhausted',
                            ),
                            '状态查询暂时不可用 ⚠️',
                            '书籍仍可能在后台处理中，请稍后刷新书架',
                            { label: '待确认' },
                        );
                        return;
                    }
                    schedule();
                };

                const tick = async () => {
                    let response;
                    try {
                        response = await fetchImpl(`${apiBaseUrl}/api/v1/books/${encodeURIComponent(bookId)}`);
                    } catch (error) {
                        handleTransientFailure('network_error', error);
                        return;
                    }

                    if (!response?.ok) {
                        const status = Number(response?.status || 0);
                        if (status === 401) {
                            finish(
                                makePollingResult(
                                    bookId,
                                    'authentication_required',
                                    '登录已失效，请重新登录后刷新书架。',
                                    'authentication_required',
                                ),
                                '登录已失效 ⚠️',
                                '请重新登录后刷新书架',
                                { label: '需登录' },
                            );
                            return;
                        }
                        if (isTransientStatus(status)) {
                            handleTransientFailure(`HTTP ${status}`, new Error(`HTTP ${status}`));
                            return;
                        }
                        finish(
                            makePollingResult(
                                bookId,
                                'polling_unavailable',
                                `状态查询失败 (HTTP ${status || 0})`,
                                'polling_http_error',
                            ),
                            '状态查询失败 ⚠️',
                            `HTTP ${status || 0}`,
                            { label: '待确认' },
                        );
                        return;
                    }

                    consecutiveFailures = 0;
                    let book;
                    try {
                        book = await response.json();
                    } catch (error) {
                        handleTransientFailure('invalid_json', error);
                        return;
                    }

                    const progress = typeof book?.progress === 'number' ? book.progress : null;
                    if (book?.status === 'completed') {
                        updateProgressUi('处理完成 ✅', 100, totalPages ? `共 ${totalPages} 页` : '');
                        setTimeoutImpl(() => {
                            panel.style.display = 'none';
                        }, 2000);
                        settled = true;
                        resolve(book);
                        return;
                    }
                    if (book?.status === 'failed') {
                        finish(book, '处理失败 ❌', book.error_message || '', { kind: 'failed' });
                        return;
                    }

                    updateProgressUi('处理中…', progress, totalPages ? `共 ${totalPages} 页` : '');
                    schedule();
                };

                schedule();
            });
        };
    }

    function resolveBookShelfPrototype(options = {}) {
        if (options.prototype) return options.prototype;
        try {
            if (typeof BookShelf !== 'undefined' && BookShelf?.prototype) return BookShelf.prototype;
        } catch (error) {
            // The global lexical binding is not available yet.
        }
        return options.rootObject?.BookShelf?.prototype || null;
    }

    function installCachePersistence(prototype, options = {}) {
        if (!prototype || prototype.__uploadCachePersistenceInstalled) return Boolean(prototype);
        const rootObject = options.rootObject || root;
        const storage = options.storage || rootObject?.localStorage;
        const writeCachedBooks = options.writeCachedBooks
            || rootObject?.ReaderResumeLifecycleV2?.writeCachedBooks
            || defaultWriteCachedBooks;

        const markUploadSession = (methodName) => {
            const original = prototype[methodName];
            if (typeof original !== 'function') return;
            prototype[methodName] = async function uploadWithCacheSession(...args) {
                this.__bookshelfUploadCacheSession = true;
                return original.apply(this, args);
            };
        };

        markUploadSession('handleFileUpload');
        markUploadSession('handleMultiFileUpload');

        const originalRenderBooks = prototype.renderBooks;
        if (typeof originalRenderBooks === 'function') {
            prototype.renderBooks = function renderBooksWithUploadCache(...args) {
                const result = originalRenderBooks.apply(this, args);
                if (this.__bookshelfUploadCacheSession && Array.isArray(this.books)) {
                    writeCachedBooks(this.books, storage);
                }
                return result;
            };
        }

        Object.defineProperty(prototype, '__uploadCachePersistenceInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function install(rootObject = root, options = {}) {
        const prototype = resolveBookShelfPrototype({ ...options, rootObject });
        if (!prototype) return false;

        installCachePersistence(prototype, { ...options, rootObject });
        if (!prototype.__authenticatedUploadPollingInstalled) {
            prototype._pollBookStatus = createBookStatusPoller({ ...options, rootObject });
            Object.defineProperty(prototype, '__authenticatedUploadPollingInstalled', {
                configurable: false,
                enumerable: false,
                writable: false,
                value: true,
            });
        }
        return true;
    }

    return {
        BOOKSHELF_CACHE_KEY,
        DEFAULT_API_BASE_URL,
        MAX_CONSECUTIVE_POLL_FAILURES,
        POLL_INTERVAL_MS,
        createBookStatusPoller,
        defaultWriteCachedBooks,
        install,
        installCachePersistence,
        isTransientStatus,
        makePollingResult,
        normalizeBaseUrl,
        resolveApiBaseUrl,
        resolveBookShelfPrototype,
    };
});
