(function () {
    'use strict';

    if (typeof BookShelf === 'undefined' || !globalThis.ReaderApi || !globalThis.ReaderModel) {
        console.error('Reader client dependencies are unavailable.');
        return;
    }

    const { ReaderApiClient, ReaderApiError } = globalThis.ReaderApi;
    const Model = globalThis.ReaderModel;
    const READER_ENABLED_KEY = 'm5.reader.v1.enabled';
    const PAGE_LIMIT = 20;

    function readerEnabled() {
        const params = new URLSearchParams(globalThis.location?.search || '');
        if (params.get('reader_v1') === '1') return true;
        if (params.get('reader_v1') === '0') return false;
        return globalThis.localStorage?.getItem(READER_ENABLED_KEY) === '1';
    }

    function setReaderEnabled(enabled) {
        globalThis.localStorage?.setItem(READER_ENABLED_KEY, enabled ? '1' : '0');
    }

    function element(id) {
        return document.getElementById(id);
    }

    function clearElement(target) {
        while (target && target.firstChild) target.removeChild(target.firstChild);
    }

    function create(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function setLegacyReaderVisible(visible) {
        const focus = element('focusModeDisplay');
        const page = element('pageModeDisplay');
        const chart = element('chartDisplay');
        const reader = element('structuredReader');
        if (reader) reader.hidden = visible;
        if (!visible) {
            focus?.classList.remove('active');
            page?.classList.remove('active');
            chart?.classList.remove('active');
        } else if (typeof switchDisplayMode === 'function') {
            switchDisplayMode();
        }
    }

    function resetLegacySpeedState() {
        if (typeof state === 'undefined') return;
        if (typeof clearReadingTimer === 'function') clearReadingTimer();
        state.content = '';
        state.cachedContentBlob = null;
        state.units = [];
        state.pages = [];
        state.currentIndex = 0;
        state.currentPageIndex = 0;
        state.currentLineIndex = 0;
        state.currentLine = 0;
        state.isPlaying = false;
        state.isPaused = false;
        state.pendingImageMarkerIndex = null;
        state.imageMarkerMap = {};
        state.isContentLoading = false;
        if (typeof updateProgress === 'function') updateProgress();
        if (typeof updateStartButtonState === 'function') updateStartButtonState();
        const toggle = element('readingToggleBtn');
        if (toggle) toggle.title = 'M5 Reader 已启用；Basic Speed Reading 将在 Slice 6 接入稳定 segment identity';
    }

    function safeReaderMessage(error) {
        if (!(error instanceof ReaderApiError)) return '结构化 Reader 暂时不可用。';
        return {
            reader_not_ready: '当前文档还没有可用的已选择结构化内容。',
            reader_selection_changed: '阅读内容版本已变化，请重新打开文档。',
            reader_selection_invalid: '当前选择的阅读内容无效。',
            reader_content_incompatible: '当前内容无法由这个 Reader 版本显示。',
            reader_network_unavailable: '无法连接结构化 Reader 服务。',
            reader_contract_version_unsupported: 'Reader 合同版本不兼容。',
        }[error.code] || error.safeMessage || '结构化 Reader 暂时不可用。';
    }

    class StructuredReaderController {
        constructor() {
            this.api = new ReaderApiClient();
            this.reset();
        }

        reset() {
            this.documentRef = null;
            this.candidateId = null;
            this.openResponse = null;
            this.pages = [];
            this.hasMore = false;
            this.nextPageOrder = 0;
            this.loading = false;
            this.currentPageId = null;
        }

        setStatus(message, kind = 'info') {
            const status = element('readerStatus');
            if (!status) return;
            status.textContent = message || '';
            status.dataset.kind = kind;
        }

        showFallbackNotice(message) {
            setLegacyReaderVisible(true);
            const toggle = element('readerModeToggle');
            if (toggle) {
                toggle.setAttribute('aria-pressed', 'true');
                toggle.classList.add('active');
            }
            const notice = element('readerCompatibilityNotice');
            if (notice) {
                notice.hidden = false;
                notice.textContent = `${message} 已使用兼容阅读模式。`;
            }
        }

        hideFallbackNotice() {
            const notice = element('readerCompatibilityNotice');
            if (notice) {
                notice.hidden = true;
                notice.textContent = '';
            }
        }

        async open(documentRef) {
            this.reset();
            this.documentRef = String(documentRef);
            this.loading = true;
            this.hideFallbackNotice();
            setLegacyReaderVisible(false);
            resetLegacySpeedState();
            this.setStatus('正在打开结构化 Reader…');
            const content = element('readerContent');
            const navigation = element('readerNavigation');
            clearElement(content);
            clearElement(navigation);

            try {
                const opened = await this.api.open(this.documentRef);
                this.openResponse = opened;
                this.candidateId = opened.candidate_id;
                this.renderOpen(opened);
                await this.loadChunk(0, { replace: true });
                this.setStatus(this.pages.length ? '' : '当前文档没有已加载的可读页面。');
            } finally {
                this.loading = false;
            }
        }

        renderOpen(opened) {
            const title = element('readerDocumentTitle');
            if (title) title.textContent = opened.metadata?.title || '结构化阅读';

            const summary = Model.recoverySummary(opened);
            const banner = element('readerRecoveryBanner');
            if (banner) {
                banner.hidden = summary.messages.length === 0;
                banner.dataset.state = summary.state;
                banner.textContent = summary.messages.join(' ');
            }

            const nav = element('readerNavigation');
            clearElement(nav);
            for (const entry of opened.navigation || []) {
                const button = create('button', 'reader-nav-item', entry.label || '未命名标题');
                button.type = 'button';
                button.style.setProperty('--reader-nav-level', String(Math.max(0, Number(entry.heading_level || 1) - 1)));
                button.addEventListener('click', () => this.navigateTo(entry.location));
                nav.appendChild(button);
            }
            if (!(opened.navigation || []).length) {
                nav.appendChild(create('p', 'reader-nav-empty', '没有可用的标题导航'));
            }
        }

        async loadChunk(startPageOrder, options = {}) {
            if (!this.documentRef || !this.candidateId) return;
            const button = element('readerLoadMoreBtn');
            if (button) button.disabled = true;
            this.setStatus('正在加载页面…');
            const chunk = await this.api.content(this.documentRef, {
                candidateId: this.candidateId,
                startPageOrder,
                limit: PAGE_LIMIT,
            });
            this.pages = options.replace ? Model.orderedPages(chunk.pages) : Model.mergePages(this.pages, chunk.pages);
            this.hasMore = Boolean(chunk.has_more);
            this.nextPageOrder = chunk.continuation?.page_order ?? (this.pages.length ? this.pages[this.pages.length - 1].page_order + 1 : 0);
            this.renderPages();
            if (button) {
                button.hidden = !this.hasMore;
                button.disabled = false;
            }
            this.setStatus('');
        }

        renderPages() {
            const container = element('readerContent');
            clearElement(container);
            for (const page of Model.orderedPages(this.pages)) {
                container.appendChild(this.renderPage(page));
            }
            if (!this.currentPageId && this.pages.length) this.currentPageId = this.pages[0].page_id;
        }

        renderPage(page) {
            const section = create('section', 'reader-page');
            section.dataset.pageId = page.page_id;
            section.dataset.pageOrder = String(page.page_order);
            section.tabIndex = -1;
            section.setAttribute('aria-label', `第 ${page.page_order + 1} 页`);

            const header = create('div', 'reader-page-header');
            header.appendChild(create('span', 'reader-page-number', `第 ${page.page_order + 1} 页`));
            if (page.content_state !== 'ready') {
                const stateBadge = create('span', 'reader-state-badge', Model.stateLabel(page.content_state));
                stateBadge.dataset.state = page.content_state;
                header.appendChild(stateBadge);
            }
            section.appendChild(header);

            for (const warning of page.warnings || []) {
                section.appendChild(create('p', 'reader-warning', `提示：${warning.code}`));
            }

            for (const node of Model.orderedNodes(page)) {
                section.appendChild(this.renderNode(node));
            }
            return section;
        }

        renderNode(node) {
            const type = node.node_type;
            const wrapper = create('div', `reader-node reader-node-${type || 'unknown'}`);
            wrapper.dataset.nodeId = node.node_id;
            wrapper.tabIndex = -1;

            if (type === 'table') {
                wrapper.appendChild(this.renderTablePlaceholder(node));
            } else if (type === 'figure') {
                const label = create('p', 'reader-figure-label', node.text || '图像');
                wrapper.appendChild(label);
            } else if (type === 'list') {
                const list = create('ul', 'reader-list');
                if (node.text) {
                    const item = create('li', '', node.text);
                    list.appendChild(item);
                }
                wrapper.appendChild(list);
            } else {
                const tag = Model.nodeTag(node);
                const body = create(tag, 'reader-node-text', node.text || '');
                wrapper.appendChild(body);
            }

            if (node.content_state !== 'ready') {
                const stateBadge = create('span', 'reader-state-badge', Model.stateLabel(node.content_state));
                stateBadge.dataset.state = node.content_state;
                wrapper.appendChild(stateBadge);
            }
            for (const warning of node.warnings || []) {
                wrapper.appendChild(create('span', 'reader-warning-inline', `提示：${warning.code}`));
            }
            for (const assetId of node.asset_refs || []) {
                wrapper.appendChild(this.renderAssetPlaceholder(assetId));
            }
            return wrapper;
        }

        renderAssetPlaceholder(assetId) {
            const figure = create('figure', 'reader-asset');
            figure.dataset.assetId = assetId;
            const button = create('button', 'reader-asset-load', '加载图像');
            button.type = 'button';
            button.addEventListener('click', () => this.loadAsset(figure, assetId, button));
            figure.appendChild(button);
            return figure;
        }

        async loadAsset(figure, assetId, button) {
            button.disabled = true;
            button.textContent = '正在加载…';
            try {
                const asset = await this.api.asset(this.documentRef, this.candidateId, assetId);
                clearElement(figure);
                const captionText = asset.caption || asset.description || '';
                if (asset.delivery_state === 'available' && asset.content_href) {
                    const image = create('img', 'reader-asset-image');
                    image.alt = asset.alt_text || captionText || '文档图像';
                    image.loading = 'lazy';
                    image.src = this.api.assetContentUrl(this.documentRef, this.candidateId, assetId);
                    image.addEventListener('error', () => {
                        image.replaceWith(create('p', 'reader-asset-unavailable', '图像内容暂时无法加载；文字内容仍可阅读。'));
                    });
                    figure.appendChild(image);
                } else {
                    figure.appendChild(create('p', 'reader-asset-unavailable', '图像内容不可用；文字内容仍可阅读。'));
                }
                if (captionText) figure.appendChild(create('figcaption', 'reader-asset-caption', captionText));
            } catch (error) {
                button.disabled = false;
                button.textContent = '重新加载图像';
                figure.appendChild(create('p', 'reader-asset-unavailable', safeReaderMessage(error)));
            }
        }

        renderTablePlaceholder(node) {
            const container = create('div', 'reader-table-container');
            container.dataset.nodeId = node.node_id;
            const button = create('button', 'reader-table-load', '加载表格');
            button.type = 'button';
            button.addEventListener('click', () => this.loadTable(container, node.node_id, 0, [], button));
            container.appendChild(button);
            return container;
        }

        async loadTable(container, nodeId, offset, priorCells, button) {
            button.disabled = true;
            button.textContent = '正在加载表格…';
            try {
                const table = await this.api.table(this.documentRef, this.candidateId, nodeId, {
                    cellOffset: offset,
                    cellLimit: 200,
                });
                const cells = priorCells.concat(table.cells || []);
                clearElement(container);
                const tableEl = create('table', 'reader-table');
                const body = create('tbody');
                const rows = new Map();
                for (const cell of cells) {
                    if (!rows.has(cell.row_index)) {
                        const row = create('tr');
                        rows.set(cell.row_index, row);
                        body.appendChild(row);
                    }
                    const td = create('td', '', cell.text || '');
                    td.rowSpan = Math.max(1, Number(cell.row_span || 1));
                    td.colSpan = Math.max(1, Number(cell.column_span || 1));
                    td.dataset.columnIndex = String(cell.column_index);
                    rows.get(cell.row_index).appendChild(td);
                }
                tableEl.appendChild(body);
                container.appendChild(tableEl);
                if (table.has_more && table.next_cell_offset != null) {
                    const more = create('button', 'reader-table-load', '加载更多表格单元格');
                    more.type = 'button';
                    more.addEventListener('click', () => this.loadTable(container, nodeId, table.next_cell_offset, cells, more));
                    container.appendChild(more);
                }
            } catch (error) {
                button.disabled = false;
                button.textContent = '重新加载表格';
                container.appendChild(create('p', 'reader-table-unavailable', safeReaderMessage(error)));
            }
        }

        async loadMore() {
            if (!this.hasMore || this.loading) return;
            this.loading = true;
            try {
                await this.loadChunk(this.nextPageOrder);
            } catch (error) {
                this.setStatus(safeReaderMessage(error), 'error');
            } finally {
                this.loading = false;
            }
        }

        async ensurePageLoaded(pageId) {
            let page = Model.findPageById(this.pages, pageId);
            let guard = 0;
            while (!page && this.hasMore && guard < 100) {
                await this.loadChunk(this.nextPageOrder);
                page = Model.findPageById(this.pages, pageId);
                guard += 1;
            }
            return page;
        }

        async navigateTo(location) {
            if (!location || location.candidate_id !== this.candidateId || location.contract_version !== '1') {
                this.setStatus('该位置属于旧的 Reader 内容版本，请重新打开文档。', 'error');
                return;
            }
            try {
                if (location.page_id) await this.ensurePageLoaded(location.page_id);
                const selector = location.node_id
                    ? `[data-node-id="${CSS.escape(location.node_id)}"]`
                    : location.page_id
                        ? `[data-page-id="${CSS.escape(location.page_id)}"]`
                        : null;
                const target = selector ? element('readerContent')?.querySelector(selector) : null;
                if (!target) {
                    this.setStatus('目标位置当前不可用。', 'error');
                    return;
                }
                this.currentPageId = location.page_id || target.closest('[data-page-id]')?.dataset.pageId || null;
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                target.focus({ preventScroll: true });
                this.setStatus('');
            } catch (error) {
                this.setStatus(safeReaderMessage(error), 'error');
            }
        }

        async movePage(delta) {
            if (!this.pages.length) return;
            let index = this.pages.findIndex((page) => page.page_id === this.currentPageId);
            if (index < 0) index = 0;
            let targetIndex = index + delta;
            if (targetIndex >= this.pages.length && this.hasMore) {
                await this.loadMore();
                targetIndex = Math.min(targetIndex, this.pages.length - 1);
            }
            if (targetIndex < 0 || targetIndex >= this.pages.length) return;
            const page = this.pages[targetIndex];
            await this.navigateTo(page.location);
        }
    }

    const controller = new StructuredReaderController();
    const originalSelectBook = BookShelf.prototype.selectBook;

    BookShelf.prototype.selectBook = async function patchedSelectBook(bookId) {
        const book = this.books.find((item) => String(item.id) === String(bookId)) || null;
        const enabled = readerEnabled();
        updateModeToggle(enabled);
        if (!enabled || !book || String(book.fileType).toLowerCase() !== 'pdf') {
            setLegacyReaderVisible(true);
            controller.hideFallbackNotice();
            const toggle = element('readingToggleBtn');
            if (toggle) toggle.title = '开始/停止阅读';
            return originalSelectBook.call(this, bookId);
        }

        this.currentBook = book;
        this.renderBooks();
        this.setLoading(true, '⏳ 正在加载结构化 Reader...');
        try {
            await controller.open(book.id);
        } catch (error) {
            console.warn('结构化 Reader 打开失败，回退兼容模式:', error);
            await originalSelectBook.call(this, bookId);
            controller.showFallbackNotice(safeReaderMessage(error));
        } finally {
            this.setLoading(false);
        }
    };

    function updateModeToggle(enabled) {
        const button = element('readerModeToggle');
        if (!button) return;
        button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        button.classList.toggle('active', enabled);
        button.textContent = enabled ? 'Reader β ✓' : 'Reader β';
    }

    document.addEventListener('DOMContentLoaded', () => {
        updateModeToggle(readerEnabled());
        element('readerModeToggle')?.addEventListener('click', async () => {
            const enabled = !readerEnabled();
            setReaderEnabled(enabled);
            updateModeToggle(enabled);
            if (typeof bookshelf !== 'undefined' && bookshelf?.currentBook) {
                await bookshelf.selectBook(bookshelf.currentBook.id);
            }
        });
        element('readerLoadMoreBtn')?.addEventListener('click', () => controller.loadMore());
        element('readerPrevPageBtn')?.addEventListener('click', () => controller.movePage(-1));
        element('readerNextPageBtn')?.addEventListener('click', () => controller.movePage(1));
        document.addEventListener('keydown', (event) => {
            if (!readerEnabled() || element('structuredReader')?.hidden) return;
            const tag = event.target?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
            if (event.altKey && event.key === 'ArrowLeft') {
                event.preventDefault();
                controller.movePage(-1);
            }
            if (event.altKey && event.key === 'ArrowRight') {
                event.preventDefault();
                controller.movePage(1);
            }
        });
    });

    globalThis.StructuredReader = {
        controller,
        readerEnabled,
        setReaderEnabled,
        safeReaderMessage,
    };
})();
