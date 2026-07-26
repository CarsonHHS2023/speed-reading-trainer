const API_BASE_URL = 'https://carsonhhs-pdf-ocr-service.hf.space';

class BookShelf {
    constructor() {
        this.books = [];
        this.categories = this.getDefaultCategories();
        this.currentBook = null;
        this.currentCategory = 'uncategorized';
        this.isLoading = false;
        this.expandedCategoryIds = new Set(['uncategorized']);
        this.dragData = null;
        this.categoryModalMode = 'createRoot';
        this.categoryModalTargetId = null;
        this.init();
    }

    getDefaultCategories() {
        return [{
            id: 'uncategorized',
            name: '未定',
            parentId: null,
            order: 0,
            children: [],
            locked: true
        }];
    }

    async init() {
        this.setupEventListeners();
        this.ensureCategoryIntegrity();
        this.renderCategories();
        this.renderBooks();
        await this.loadBooksFromBackend();
    }

    setupEventListeners() {
        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');
        const addCategoryBtn = document.getElementById('addCategoryBtn');
        const closeProcessingBtn = document.getElementById('closeProcessingBtn');
        const categoryModal = document.getElementById('categoryModal');
        const categoryInput = document.getElementById('categoryInput');
        const categoryCancelBtn = document.getElementById('categoryCancelBtn');
        const categoryConfirmBtn = document.getElementById('categoryConfirmBtn');
        const closeCategoryModalBtn = document.getElementById('closeCategoryModalBtn');
        const bookInfoOverlay = document.getElementById('bookInfoOverlay');
        const closeBookInfoBtn = document.getElementById('closeBookInfoBtn');

        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('drag-over');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('drag-over');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleMultiFileUpload(Array.from(files));
            }
        });

        uploadZone.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!this.isLoading) {
                fileInput.click();
            }
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleMultiFileUpload(Array.from(e.target.files));
                fileInput.value = '';
            }
        });

        addCategoryBtn.addEventListener('click', () => {
            this.openCategoryModal('createRoot');
        });

        closeProcessingBtn?.addEventListener('click', () => {
            this.closeProcessingPanel();
        });

        categoryCancelBtn?.addEventListener('click', () => this.closeCategoryModal());
        closeCategoryModalBtn?.addEventListener('click', () => this.closeCategoryModal());
        categoryConfirmBtn?.addEventListener('click', () => this.confirmCategoryAction());
        categoryInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.confirmCategoryAction();
            }
        });

        closeBookInfoBtn?.addEventListener('click', () => this.hideBookInfo());

        categoryModal?.addEventListener('click', (e) => {
            if (e.target === categoryModal) {
                this.closeCategoryModal();
            }
        });

        bookInfoOverlay?.addEventListener('click', (e) => {
            if (e.target === bookInfoOverlay) {
                this.hideBookInfo();
            }
        });

        document.addEventListener('click', (e) => {
            const contextMenu = document.getElementById('categoryContextMenu');
            if (contextMenu && !contextMenu.contains(e.target)) {
                this.hideCategoryContextMenu();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hideCategoryContextMenu();
                this.closeCategoryModal();
                this.hideBookInfo();
            }
        });
    }

    closeProcessingPanel() {
        const panel = document.getElementById('processingPanel');
        if (panel) {
            panel.style.display = 'none';
        }
    }

    setLoading(isLoading, message = '📁 拖拽或<br><span>点击上传</span>') {
        this.isLoading = isLoading;
        const uploadZone = document.getElementById('uploadZone');
        const uploadPrompt = uploadZone.querySelector('.upload-prompt');

        uploadZone.classList.toggle('processing', isLoading);
        uploadPrompt.innerHTML = message;
    }

    normalizeBook(rawBook) {
        const categoryId = rawBook.category_id || rawBook.categoryId || rawBook.category || 'uncategorized';
        return {
            id: rawBook.book_id || rawBook.id,
            name: rawBook.book_title || rawBook.title || rawBook.name || '未命名书籍',
            fileType: rawBook.file_type || rawBook.fileType || 'txt',
            categoryId: String(categoryId || 'uncategorized'),
            uploadDate: rawBook.created_at || rawBook.uploadDate || new Date().toLocaleString('zh-CN'),
            progress: rawBook.progress || 0,
            pageCount: rawBook.pages_count || rawBook.pageCount || rawBook.total_pages || null,
            author: rawBook.author || '—',
            publishDate: rawBook.publish_date || rawBook.publishDate || '—',
            status: rawBook.status || 'ready'
        };
    }

    getCategoryById(categoryId) {
        return this.categories.find((category) => String(category.id) === String(categoryId)) || null;
    }

    isSpecialCategory(categoryId) {
        return String(categoryId) === 'uncategorized';
    }

    getSortedCategories(parentId) {
        return this.categories
            .filter((category) => String(category.parentId) === String(parentId))
            .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'));
    }

    getCategoryDepth(categoryId) {
        let depth = 0;
        let current = this.getCategoryById(categoryId);
        while (current && current.parentId !== null) {
            depth += 1;
            current = this.getCategoryById(current.parentId);
        }
        return depth;
    }

    isDescendant(categoryId, potentialAncestorId) {
        let current = this.getCategoryById(categoryId);
        while (current && current.parentId !== null) {
            if (String(current.parentId) === String(potentialAncestorId)) {
                return true;
            }
            current = this.getCategoryById(current.parentId);
        }
        return false;
    }

    getDescendantCategoryIds(categoryId) {
        const ids = new Set([String(categoryId)]);
        const visit = (parentId) => {
            this.categories
                .filter((category) => String(category.parentId) === String(parentId))
                .forEach((category) => {
                    ids.add(String(category.id));
                    visit(category.id);
                });
        };
        visit(categoryId);
        return ids;
    }

    canNestUnder(parentId) {
        if (parentId === null) {
            return true;
        }
        if (this.isSpecialCategory(parentId)) {
            return false;
        }
        return this.getCategoryDepth(parentId) < 2;
    }

    normalizeCategoryId(categoryId) {
        if (!categoryId || !this.getCategoryById(categoryId)) {
            return 'uncategorized';
        }
        return String(categoryId);
    }

    ensureCategoryIntegrity() {
        const uncategorized = this.getCategoryById('uncategorized');
        if (!uncategorized) {
            this.categories.unshift(...this.getDefaultCategories());
        }

        this.categories = this.categories.map((category, index) => ({
            ...category,
            id: String(category.id),
            parentId: category.parentId === null || category.parentId === undefined ? null : String(category.parentId),
            order: Number.isFinite(category.order) ? category.order : index,
            children: [],
            locked: this.isSpecialCategory(category.id) || Boolean(category.locked)
        }));

        this.categories.forEach((category) => {
            if (this.isSpecialCategory(category.id)) {
                category.parentId = null;
                category.order = -1;
                category.locked = true;
                return;
            }

            if (category.parentId && !this.getCategoryById(category.parentId)) {
                category.parentId = null;
            }

            if (category.parentId && this.getCategoryDepth(category.id) > 2) {
                category.parentId = null;
            }
        });

        const groupedParentIds = new Set(this.categories.map((category) => category.parentId));
        groupedParentIds.forEach((parentId) => {
            this.getSortedCategories(parentId).forEach((category, index) => {
                category.order = parentId === null && this.isSpecialCategory(category.id) ? -1 : index;
            });
        });

        this.categories.forEach((category) => {
            category.children = this.getSortedCategories(category.id);
        });

        this.books = this.books.map((book) => ({
            ...book,
            categoryId: this.normalizeCategoryId(book.categoryId)
        }));

        if (!this.getCategoryById(this.currentCategory)) {
            this.currentCategory = 'uncategorized';
        }
    }

    async loadBooksFromBackend() {
        this.setLoading(true, '⏳ 正在加载书架...');

        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/books`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            const books = Array.isArray(result.books) ? result.books : [];
            this.books = books
                .filter((book) => book.status !== 'processing')
                .map((book) => this.normalizeBook(book));

            this.ensureCategoryIntegrity();
            this.renderCategories();
            this.renderBooks();
        } catch (error) {
            console.error('加载书籍失败:', error);
            this.books = [];
            this.ensureCategoryIntegrity();
            this.renderCategories();
            this.renderBooks();
        } finally {
            this.setLoading(false);
        }
    }

    async _pollBookStatus(bookId, bookName, totalPages) {
        const panel = document.getElementById('processingPanel');
        const nameEl = document.getElementById('processingBookName');
        const statusEl = document.getElementById('processingStatus');
        const percentEl = document.getElementById('processingPercent');
        const fill = document.getElementById('processingBarFill');
        const info = document.getElementById('processingPageInfo');

        if (!panel || !nameEl || !statusEl || !percentEl || !fill || !info) {
            return { book_id: bookId, status: 'failed', error_message: '处理进度面板未初始化' };
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
            if (failed) {
                percentEl.textContent = '失败';
            }
        };

        updateProgressUi('处理中…', null, totalPages ? `共 ${totalPages} 页` : '');

        const POLL_INTERVAL_MS = 5000;

        return new Promise((resolve) => {
            const tick = async () => {
                try {
                    const resp = await fetch(`${API_BASE_URL}/api/v1/books/${encodeURIComponent(bookId)}`);
                    if (!resp.ok) {
                        throw new Error(`HTTP ${resp.status}`);
                    }

                    const book = await resp.json();
                    const progress = typeof book.progress === 'number' ? book.progress : null;

                    if (book.status === 'completed') {
                        updateProgressUi('处理完成 ✅', 100, totalPages ? `共 ${totalPages} 页` : '');
                        setTimeout(() => {
                            panel.style.display = 'none';
                        }, 2000);
                        resolve(book);
                    } else if (book.status === 'failed') {
                        updateProgressUi('处理失败 ❌', 100, book.error_message || '', true);
                        resolve(book);
                    } else {
                        updateProgressUi('处理中…', progress, totalPages ? `共 ${totalPages} 页` : '');
                        setTimeout(tick, POLL_INTERVAL_MS);
                    }
                } catch (error) {
                    console.error('轮询状态失败:', error);
                    setTimeout(tick, POLL_INTERVAL_MS);
                }
            };

            setTimeout(tick, POLL_INTERVAL_MS);
        });
    }

    async handleFileUpload(file) {
        this.setLoading(true, '⏳ 正在上传文件...');

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(`${API_BASE_URL}/api/v1/upload`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();

            if (result.status === 'processing') {
                this.setLoading(false);
                const finalBook = await this._pollBookStatus(
                    result.book_id,
                    result.book_title || file.name,
                    result.pages_count || null
                );
                if (finalBook.status === 'completed') {
                    const book = this.normalizeBook(finalBook);
                    this.books.unshift(book);
                    this.ensureCategoryIntegrity();
                    this.renderCategories();
                    this.renderBooks();
                    await this.selectBook(book.id);
                }
            } else if (result.status === 'completed') {
                const book = this.normalizeBook(result);
                this.books.unshift(book);
                this.ensureCategoryIntegrity();
                this.renderCategories();
                this.renderBooks();
                await this.selectBook(book.id);
                this.setLoading(false);
            } else {
                this.setLoading(false);
            }
        } catch (error) {
            console.error('上传失败:', error);
            alert('上传失败，请检查网络或文件格式');
            this.setLoading(false);
        }
    }

    async handleMultiFileUpload(files) {
        if (files.length === 0) {
            return;
        }
        if (files.length === 1) {
            return this.handleFileUpload(files[0]);
        }

        const CONCURRENCY = 3;
        const items = files.map((file) => ({
            file,
            name: file.name,
            status: 'queued',
            error: null,
            book: null
        }));

        this.renderBatchPanel(items);

        let nextIndex = 0;
        const runNext = async () => {
            if (nextIndex >= items.length) {
                return;
            }

            const item = items[nextIndex++];
            item.status = 'uploading';
            this.renderBatchPanel(items);

            try {
                const formData = new FormData();
                formData.append('file', item.file);
                const response = await fetch(`${API_BASE_URL}/api/v1/upload`, {
                    method: 'POST',
                    body: formData
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const result = await response.json();
                if (result.status === 'processing') {
                    item.status = 'success';
                    item.book = this.normalizeBook(result);
                    this.renderBatchPanel(items);
                    this._pollBookStatus(
                        result.book_id,
                        result.book_title || item.name,
                        result.pages_count || null
                    ).then((finalBook) => {
                        if (finalBook.status === 'completed') {
                            const book = this.normalizeBook(finalBook);
                            item.book = book;
                            this.books.unshift(book);
                            this.ensureCategoryIntegrity();
                            this.renderCategories();
                            this.renderBooks();
                            this.renderBatchPanel(items);
                        }
                    });
                } else {
                    item.book = this.normalizeBook(result);
                    item.status = 'success';
                    this.books.unshift(item.book);
                    this.ensureCategoryIntegrity();
                    this.renderCategories();
                    this.renderBooks();
                }
            } catch (error) {
                item.status = 'failed';
                item.error = error.message || '上传失败';
                console.error('上传失败:', item.name, error);
            }

            this.renderBatchPanel(items);
            await runNext();
        };

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, runNext));
    }

    renderBatchPanel(items) {
        const panel = document.getElementById('batchPanel');
        const summary = document.getElementById('batchSummary');
        const list = document.getElementById('batchList');

        const total = items.length;
        const success = items.filter((item) => item.status === 'success').length;
        const failed = items.filter((item) => item.status === 'failed').length;
        const active = items.filter((item) => item.status === 'uploading' || item.status === 'queued').length;

        panel.style.display = 'block';
        summary.textContent = `共${total} · 成功${success} · 失败${failed} · 处理中${active}`;

        list.innerHTML = '';
        const statusIcon = { queued: '⏳', uploading: '🔄', success: '✅', failed: '❌' };
        items.forEach((item) => {
            const row = document.createElement('div');
            row.className = `batch-item batch-item-${item.status}`;

            const nameEl = document.createElement('span');
            nameEl.className = 'batch-item-name';
            nameEl.textContent = `${statusIcon[item.status] || ''} ${item.name}`;
            if (item.error) {
                nameEl.title = item.error;
            }
            row.appendChild(nameEl);

            if (item.status === 'success' && item.book && item.book.status !== 'processing') {
                const openBtn = document.createElement('button');
                openBtn.className = 'batch-item-open';
                openBtn.textContent = '打开';
                openBtn.addEventListener('click', () => this.selectBook(item.book.id));
                row.appendChild(openBtn);
            }

            if (item.status === 'failed' && item.error) {
                const errEl = document.createElement('span');
                errEl.className = 'batch-item-error';
                errEl.textContent = item.error;
                row.appendChild(errEl);
            }

            list.appendChild(row);
        });
    }

    async selectBook(bookId) {
        state.content = '';
        state.cachedContentBlob = null;
        state.units = [];
        state.pages = [];
        state.currentIndex = 0;
        state.currentPageIndex = 0;
        state.currentLineIndex = 0;
        state.totalPausedDuration = 0;
        state.currentLine = 0;
        state.isPlaying = false;
        state.isPaused = false;
        state.pendingImageMarkerIndex = null;
        state.imageMarkerMap = {};
        state.isContentLoading = true;
        clearReadingTimer();

        this.currentBook = this.books.find((book) => String(book.id) === String(bookId)) || null;

        if (!this.currentBook) {
            resetDisplay();
            updateProgress();
            state.isContentLoading = false;
            updateStartButtonState();
            this.renderBooks();
            return;
        }

        this.renderBooks();
        this.setLoading(true, '⏳ 正在加载书籍内容...');
        updateStartButtonState();

        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/books/${encodeURIComponent(bookId)}/content`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            const content = typeof result.content === 'string' ? result.content : '';

            if (!content || content.trim().length === 0) {
                state.content = '';
                state.cachedContentBlob = null;
                state.units = [];
                state.imageMarkerMap = {};
                resetDisplay();
                updateProgress();
                return;
            }

            state.cachedContentBlob = new File(
                [content],
                `${this.currentBook?.name || 'book'}.txt`,
                { type: 'text/plain;charset=utf-8' }
            );

            resetDisplay();
            updateProgress();
            state.isContentLoading = false;
            updateStartButtonState();
        } catch (error) {
            console.error('加载书籍内容失败:', error);
            state.content = '';
            state.cachedContentBlob = null;
            state.units = [];
            state.pages = [];
            state.imageMarkerMap = {};
            resetDisplay();
            updateProgress();
        } finally {
            state.isContentLoading = false;
            updateStartButtonState();
            this.setLoading(false);
        }
    }

    async deleteBook(bookId) {
        if (!confirm('确定要删除这本书吗？')) {
            return;
        }

        this.setLoading(true, '⏳ 正在删除书籍...');

        try {
            const response = await fetch(`${API_BASE_URL}/api/v1/books/${encodeURIComponent(bookId)}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            this.books = this.books.filter((book) => String(book.id) !== String(bookId));

            if (this.currentBook && String(this.currentBook.id) === String(bookId)) {
                this.currentBook = null;
                state.content = '';
                state.cachedContentBlob = null;
                state.units = [];
                state.pages = [];
                state.currentIndex = 0;
                state.currentPageIndex = 0;
                state.totalPausedDuration = 0;
                state.currentLine = 0;
                state.isPlaying = false;
                state.isPaused = false;
                state.pendingImageMarkerIndex = null;
                state.imageMarkerMap = {};
                state.isContentLoading = false;
                clearReadingTimer();
                resetDisplay();
                updateProgress();
                updateStartButtonState();
            }

            this.ensureCategoryIntegrity();
            this.renderCategories();
            this.renderBooks();
        } catch (error) {
            console.error('删除书籍失败:', error);
            alert('删除书籍失败，请稍后重试');
        } finally {
            this.setLoading(false);
        }
    }

    moveBookToCategory(bookId, categoryId) {
        const book = this.books.find((item) => String(item.id) === String(bookId));
        if (!book) {
            return;
        }

        book.categoryId = this.normalizeCategoryId(categoryId);
        this.renderCategories();
        this.renderBooks();
    }

    moveBookBefore(sourceBookId, beforeBookId = null) {
        const sourceIndex = this.books.findIndex((book) => String(book.id) === String(sourceBookId));
        if (sourceIndex < 0) {
            return;
        }

        const [sourceBook] = this.books.splice(sourceIndex, 1);
        const targetIndex = beforeBookId === null
            ? this.books.length
            : this.books.findIndex((book) => String(book.id) === String(beforeBookId));

        if (targetIndex < 0) {
            this.books.push(sourceBook);
        } else {
            this.books.splice(targetIndex, 0, sourceBook);
        }

        this.renderBooks();
    }

    getVisibleBooks() {
        if (this.currentCategory === 'uncategorized') {
            return this.books.filter((book) => book.categoryId === 'uncategorized');
        }

        const visibleCategoryIds = this.getDescendantCategoryIds(this.currentCategory);
        return this.books.filter((book) => visibleCategoryIds.has(String(book.categoryId)));
    }

    getCategoryBookCount(categoryId) {
        if (String(categoryId) === 'uncategorized') {
            return this.books.filter((book) => book.categoryId === 'uncategorized').length;
        }

        const categoryIds = this.getDescendantCategoryIds(categoryId);
        return this.books.filter((book) => categoryIds.has(String(book.categoryId))).length;
    }

    setDragData(event, data) {
        this.dragData = data;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', JSON.stringify(data));
    }

    getDragData(event) {
        const raw = event.dataTransfer.getData('text/plain');
        if (!raw) {
            return this.dragData;
        }
        try {
            return JSON.parse(raw);
        } catch (error) {
            return this.dragData;
        }
    }

    renderCategories() {
        this.ensureCategoryIntegrity();
        const categoriesDiv = document.querySelector('.categories');
        categoriesDiv.innerHTML = '';
        categoriesDiv.appendChild(this.buildCategoryLevel(null, 0));
    }

    buildCategoryLevel(parentId, level) {
        const fragment = document.createDocumentFragment();
        const categories = this.getSortedCategories(parentId);

        categories.forEach((category) => {
            fragment.appendChild(this.createCategoryDropGap(parentId, category.id, level));
            fragment.appendChild(this.createCategoryNode(category, level));
        });

        fragment.appendChild(this.createCategoryDropGap(parentId, null, level));
        return fragment;
    }

    createCategoryDropGap(parentId, beforeCategoryId, level) {
        const gap = document.createElement('div');
        gap.className = 'category-drop-gap';
        gap.style.marginLeft = `${level * 16}px`;

        gap.addEventListener('dragover', (e) => {
            const dragData = this.getDragData(e);
            if (dragData?.type === 'category') {
                e.preventDefault();
                gap.classList.add('drag-over');
            }
        });

        gap.addEventListener('dragleave', () => {
            gap.classList.remove('drag-over');
        });

        gap.addEventListener('drop', (e) => {
            const dragData = this.getDragData(e);
            gap.classList.remove('drag-over');
            if (dragData?.type === 'category') {
                e.preventDefault();
                this.reorderCategory(dragData.categoryId, parentId, beforeCategoryId);
            }
        });

        return gap;
    }

    createCategoryNode(category, level) {
        const node = document.createElement('div');
        node.className = 'category-node';
        node.dataset.category = category.id;

        const header = document.createElement('div');
        header.className = 'category-header';
        header.dataset.category = category.id;
        header.style.paddingLeft = `${8 + level * 16}px`;
        if (this.currentCategory === category.id) {
            header.classList.add('active');
        }

        const hasChildren = category.children.length > 0;
        const expanded = this.expandedCategoryIds.has(category.id);

        const arrow = document.createElement('span');
        arrow.className = 'category-arrow';
        arrow.textContent = hasChildren && expanded ? '▼' : '▶';

        const name = document.createElement('span');
        name.className = 'category-name';
        name.textContent = category.name;

        const count = document.createElement('span');
        count.className = 'book-count';
        count.textContent = this.getCategoryBookCount(category.id);

        header.appendChild(arrow);
        header.appendChild(name);
        header.appendChild(count);

        if (!category.locked) {
            header.draggable = true;
            header.addEventListener('dragstart', (e) => {
                header.classList.add('dragging');
                this.setDragData(e, { type: 'category', categoryId: category.id });
            });
            header.addEventListener('dragend', () => {
                header.classList.remove('dragging');
                this.dragData = null;
                document.querySelectorAll('.drag-over').forEach((element) => element.classList.remove('drag-over'));
            });
        }

        header.addEventListener('click', () => {
            this.selectCategory(category.id);
            if (hasChildren) {
                this.toggleCategoryExpanded(category.id);
            }
        });

        header.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showCategoryContextMenu(e, category);
        });

        header.addEventListener('dragover', (e) => {
            const dragData = this.getDragData(e);
            if (!dragData) {
                return;
            }
            if (dragData.type === 'book' || dragData.type === 'category') {
                e.preventDefault();
                header.classList.add('drag-over');
            }
        });

        header.addEventListener('dragleave', () => {
            header.classList.remove('drag-over');
        });

        header.addEventListener('drop', (e) => {
            const dragData = this.getDragData(e);
            header.classList.remove('drag-over');
            if (!dragData) {
                return;
            }
            e.preventDefault();
            if (dragData.type === 'book') {
                this.moveBookToCategory(dragData.bookId, category.id);
            } else if (dragData.type === 'category') {
                this.moveCategoryAsChild(dragData.categoryId, category.id);
            }
        });

        node.appendChild(header);

        if (hasChildren && expanded) {
            const children = document.createElement('div');
            children.className = 'category-children';
            children.appendChild(this.buildCategoryLevel(category.id, level + 1));
            node.appendChild(children);
        }

        return node;
    }

    toggleCategoryExpanded(categoryId) {
        if (this.expandedCategoryIds.has(categoryId)) {
            this.expandedCategoryIds.delete(categoryId);
        } else {
            this.expandedCategoryIds.add(categoryId);
        }
        this.renderCategories();
    }

    selectCategory(categoryId) {
        this.currentCategory = this.normalizeCategoryId(categoryId);
        this.renderCategories();
        this.renderBooks();
    }

    reorderCategory(sourceCategoryId, parentId, beforeCategoryId) {
        if (this.isSpecialCategory(sourceCategoryId)) {
            return;
        }
        if (parentId !== null && !this.canNestUnder(parentId)) {
            return;
        }
        if (String(sourceCategoryId) === String(parentId) || this.isDescendant(parentId, sourceCategoryId)) {
            return;
        }
        if (beforeCategoryId && this.isDescendant(beforeCategoryId, sourceCategoryId)) {
            return;
        }

        const sourceCategory = this.getCategoryById(sourceCategoryId);
        if (!sourceCategory) {
            return;
        }

        sourceCategory.parentId = parentId;
        const siblings = this.getSortedCategories(parentId)
            .filter((category) => String(category.id) !== String(sourceCategoryId));
        const insertIndex = beforeCategoryId === null
            ? siblings.length
            : siblings.findIndex((category) => String(category.id) === String(beforeCategoryId));

        siblings.splice(insertIndex < 0 ? siblings.length : insertIndex, 0, sourceCategory);
        siblings.forEach((category, index) => {
            category.parentId = parentId;
            category.order = index;
        });

        this.ensureCategoryIntegrity();
        this.renderCategories();
        this.renderBooks();
    }

    moveCategoryAsChild(sourceCategoryId, targetCategoryId) {
        if (this.isSpecialCategory(sourceCategoryId) || this.isSpecialCategory(targetCategoryId)) {
            return;
        }
        if (!this.canNestUnder(targetCategoryId)) {
            return;
        }

        this.expandedCategoryIds.add(String(targetCategoryId));
        this.reorderCategory(sourceCategoryId, targetCategoryId, null);
    }

    showCategoryContextMenu(event, category) {
        const menu = document.getElementById('categoryContextMenu');
        if (!menu) {
            return;
        }

        const actions = [
            {
                label: '重命名',
                disabled: category.locked,
                handler: () => this.openCategoryModal('rename', category.id, category.name)
            },
            {
                label: '添加子目录',
                disabled: !this.canNestUnder(category.id),
                handler: () => this.openCategoryModal('createChild', category.id)
            },
            {
                label: '删除',
                disabled: category.locked,
                handler: () => this.deleteCategory(category.id)
            }
        ];

        menu.innerHTML = '';
        actions.forEach((action) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = action.label;
            button.disabled = action.disabled;
            button.addEventListener('click', () => {
                this.hideCategoryContextMenu();
                action.handler();
            });
            menu.appendChild(button);
        });

        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
        menu.classList.add('show');
    }

    hideCategoryContextMenu() {
        const menu = document.getElementById('categoryContextMenu');
        if (menu) {
            menu.classList.remove('show');
        }
    }

    openCategoryModal(mode, targetCategoryId = null, initialName = '') {
        const modal = document.getElementById('categoryModal');
        const title = document.getElementById('categoryModalTitle');
        const input = document.getElementById('categoryInput');

        this.categoryModalMode = mode;
        this.categoryModalTargetId = targetCategoryId;

        if (title) {
            title.textContent = mode === 'rename' ? '重命名目录' : '添加目录';
        }
        if (input) {
            input.value = initialName;
            input.focus();
        }
        modal?.classList.add('show');
    }

    closeCategoryModal() {
        const modal = document.getElementById('categoryModal');
        const input = document.getElementById('categoryInput');
        modal?.classList.remove('show');
        if (input) {
            input.value = '';
        }
        this.categoryModalMode = 'createRoot';
        this.categoryModalTargetId = null;
    }

    confirmCategoryAction() {
        const input = document.getElementById('categoryInput');
        const name = input?.value.trim() || '';

        if (!name) {
            alert('请输入分类名称');
            return;
        }

        if (this.categoryModalMode === 'rename') {
            const category = this.getCategoryById(this.categoryModalTargetId);
            if (category && !category.locked) {
                category.name = name;
            }
        } else {
            this.addCategory(name, this.categoryModalMode === 'createChild' ? this.categoryModalTargetId : null);
        }

        this.ensureCategoryIntegrity();
        this.renderCategories();
        this.renderBooks();
        this.closeCategoryModal();
    }

    addCategory(name, parentId = null) {
        if (parentId !== null && !this.canNestUnder(parentId)) {
            alert('最多只支持三级目录');
            return;
        }

        this.categories.push({
            id: `cat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name,
            parentId,
            order: this.getSortedCategories(parentId).length,
            children: [],
            locked: false
        });

        if (parentId !== null) {
            this.expandedCategoryIds.add(String(parentId));
        }
    }

    deleteCategory(categoryId) {
        if (this.isSpecialCategory(categoryId)) {
            return;
        }
        if (!confirm('确定要删除这个目录吗？')) {
            return;
        }

        const category = this.getCategoryById(categoryId);
        if (!category) {
            return;
        }

        this.categories.forEach((item) => {
            if (String(item.parentId) === String(categoryId)) {
                item.parentId = category.parentId;
            }
        });

        this.books.forEach((book) => {
            if (String(book.categoryId) === String(categoryId)) {
                book.categoryId = 'uncategorized';
            }
        });

        this.categories = this.categories.filter((item) => String(item.id) !== String(categoryId));
        this.expandedCategoryIds.delete(String(categoryId));
        if (this.currentCategory === categoryId) {
            this.currentCategory = 'uncategorized';
        }

        this.ensureCategoryIntegrity();
        this.renderCategories();
        this.renderBooks();
    }

    renderBooks() {
        const booksList = document.getElementById('booksList');
        const filteredBooks = this.getVisibleBooks();
        booksList.innerHTML = '';

        if (filteredBooks.length === 0) {
            booksList.innerHTML = '<div class="books-empty">暂无书籍</div>';
            return;
        }

        filteredBooks.forEach((book) => {
            booksList.appendChild(this.createBookDropGap(book.id));
            booksList.appendChild(this.createBookItem(book));
        });
        booksList.appendChild(this.createBookDropGap(null));
    }

    createBookDropGap(beforeBookId) {
        const gap = document.createElement('div');
        gap.className = 'book-drop-gap';

        gap.addEventListener('dragover', (e) => {
            const dragData = this.getDragData(e);
            if (dragData?.type === 'book') {
                e.preventDefault();
                gap.classList.add('drag-over');
            }
        });

        gap.addEventListener('dragleave', () => {
            gap.classList.remove('drag-over');
        });

        gap.addEventListener('drop', (e) => {
            const dragData = this.getDragData(e);
            gap.classList.remove('drag-over');
            if (dragData?.type === 'book') {
                e.preventDefault();
                this.moveBookBefore(dragData.bookId, beforeBookId);
            }
        });

        return gap;
    }

    createBookItem(book) {
        const bookItem = document.createElement('div');
        bookItem.className = 'book-item';
        bookItem.dataset.bookId = String(book.id);
        bookItem.draggable = true;

        if (this.currentBook && String(this.currentBook.id) === String(book.id)) {
            bookItem.classList.add('active');
        }

        const nameSpan = document.createElement('span');
        nameSpan.className = 'book-item-name';
        nameSpan.title = book.name;
        nameSpan.textContent = book.name;

        nameSpan.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showBookInfo(book);
        });

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'book-item-actions';

        const sortBtn = document.createElement('button');
        sortBtn.type = 'button';
        sortBtn.className = 'book-item-action book-item-handle';
        sortBtn.title = '拖拽排序';
        sortBtn.textContent = '↕';

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'book-item-action';
        deleteBtn.title = '删除';
        deleteBtn.textContent = '✕';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteBook(book.id);
        });

        actionsDiv.appendChild(sortBtn);
        actionsDiv.appendChild(deleteBtn);
        bookItem.appendChild(nameSpan);
        bookItem.appendChild(actionsDiv);

        bookItem.addEventListener('click', () => this.selectBook(book.id));

        bookItem.addEventListener('dragstart', (e) => {
            bookItem.classList.add('dragging');
            this.setDragData(e, { type: 'book', bookId: book.id });
        });

        bookItem.addEventListener('dragend', () => {
            bookItem.classList.remove('dragging');
            this.dragData = null;
            document.querySelectorAll('.drag-over').forEach((element) => element.classList.remove('drag-over'));
        });

        bookItem.addEventListener('dragover', (e) => {
            const dragData = this.getDragData(e);
            if (dragData?.type === 'book' && String(dragData.bookId) !== String(book.id)) {
                e.preventDefault();
                bookItem.classList.add('drag-over');
            }
        });

        bookItem.addEventListener('dragleave', () => {
            bookItem.classList.remove('drag-over');
        });

        bookItem.addEventListener('drop', (e) => {
            const dragData = this.getDragData(e);
            bookItem.classList.remove('drag-over');
            if (dragData?.type === 'book' && String(dragData.bookId) !== String(book.id)) {
                e.preventDefault();
                this.moveBookBefore(dragData.bookId, book.id);
            }
        });

        return bookItem;
    }

    showBookInfo(book) {
        const overlay = document.getElementById('bookInfoOverlay');
        document.getElementById('infoBookName').textContent = book.name || '—';
        document.getElementById('infoFileType').textContent = book.fileType || '—';
        document.getElementById('infoUploadDate').textContent = book.uploadDate || '—';
        document.getElementById('infoPageCount').textContent = book.pageCount || book.progress || '—';
        document.getElementById('infoAuthor').textContent = book.author || '—';
        document.getElementById('infoPublishDate').textContent = book.publishDate || '—';
        overlay?.classList.add('show');
    }

    hideBookInfo() {
        document.getElementById('bookInfoOverlay')?.classList.remove('show');
    }
}

let bookshelf;

document.addEventListener('DOMContentLoaded', () => {
    bookshelf = new BookShelf();
});
