// ==================== 书架管理系统 ====================

const API_BASE_URL = 'https://carsonhhs-pdf-ocr-service.hf.space';

class BookShelf {
    constructor() {
        this.books = [];
        this.categories = [];
        this.currentBook = null;
        this.currentCategory = 'all';
        this.isLoading = false;
        this.init();
    }

    async init() {
        this.setupEventListeners();
        this.renderCategories();
        await this.loadBooksFromBackend();
    }

    setupEventListeners() {
        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');
        const addCategoryBtn = document.getElementById('addCategoryBtn');

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
                this.handleFileUpload(files[0]);
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
                this.handleFileUpload(e.target.files[0]);
                fileInput.value = '';
            }
        });

        addCategoryBtn.addEventListener('click', () => showCategoryModal());
    }

    setLoading(isLoading, message = '📁 拖拽或<br><span>点击上传</span>') {
        this.isLoading = isLoading;
        const uploadZone = document.getElementById('uploadZone');
        const uploadPrompt = uploadZone.querySelector('.upload-prompt');

        uploadZone.classList.toggle('processing', isLoading);
        uploadPrompt.innerHTML = message;
    }

    normalizeBook(rawBook) {
        return {
            id: rawBook.book_id || rawBook.id,
            name: rawBook.book_title || rawBook.title || rawBook.name || '未命名书籍',
            fileType: rawBook.file_type || rawBook.fileType || 'txt',
            category: rawBook.category || 'reading',
            uploadDate: rawBook.created_at || rawBook.uploadDate || new Date().toLocaleString('zh-CN'),
            progress: rawBook.progress || 0,
            status: rawBook.status || 'ready'
        };
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
            this.books = books.map((book) => this.normalizeBook(book));

            this.renderBooks();
            this.updateCategoryCounts();
        } catch (error) {
            console.error('加载书籍失败:', error);
            this.books = [];
            this.renderBooks();
            this.updateCategoryCounts();
        } finally {
            this.setLoading(false);
        }
    }

    async handleFileUpload(file) {
        this.setLoading(true, '⏳ 正在上传并处理文件...');

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
            const book = this.normalizeBook(result);

            this.books.unshift(book);
            this.renderBooks();
            this.updateCategoryCounts();

            await this.selectBook(book.id);
        } catch (error) {
            console.error('上传失败:', error);
            alert('上传失败，请检查网络或文件格式');
        } finally {
            this.setLoading(false);
        }
    }

    async selectBook(bookId) {
        // 清空旧数据
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

        this.currentBook = this.books.find((b) => String(b.id) === String(bookId)) || null;

        document.querySelectorAll('.book-item').forEach((item) => {
            item.classList.remove('active');
        });

        document.querySelector(`[data-book-id="${CSS.escape(String(bookId))}"]`)?.classList.add('active');

        if (!this.currentBook) {
            state.content = '';
            state.units = [];
            resetDisplay();
            state.isContentLoading = false;
            updateStartButtonState();
            return;
        }

        this.setLoading(true, '⏳ 正在加载书籍内容...');
        elements.startBtn.disabled = true;
        elements.pauseBtn.disabled = true;
        elements.resumeBtn.disabled = true;
        elements.stopBtn.disabled = true;

        try {
            const url = `${API_BASE_URL}/api/v1/books/${encodeURIComponent(bookId)}/content`;
            console.log('正在加载:', url);

            const response = await fetch(url);
            console.log('Response status:', response.status);
            console.log('Response ok:', response.ok);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            console.log('Response result:', result);

            const content = typeof result.content === 'string' ? result.content : '';
            console.log('Content length:', content.length);

            // 检查内容是否为空
            if (!content || content.trim().length === 0) {
                console.warn('加载的书籍内容为空');
                state.content = '';
                state.cachedContentBlob = null;
                state.units = [];
                state.imageMarkerMap = {};
                resetDisplay();
                return;
            }

            state.cachedContentBlob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            resetDisplay();
        } catch (error) {
            console.error('加载书籍内容失败:', error);
            console.error('Error stack:', error.stack);
            // 错误时清空所有数据
            state.content = '';
            state.cachedContentBlob = null;
            state.units = [];
            state.pages = [];
            state.imageMarkerMap = {};
            resetDisplay();
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

            this.books = this.books.filter((b) => String(b.id) !== String(bookId));

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
                updateStartButtonState();
            }

            this.renderBooks();
            this.updateCategoryCounts();
        } catch (error) {
            console.error('删除书籍失败:', error);
            alert('删除书籍失败，请稍后重试');
        } finally {
            this.setLoading(false);
        }
    }

    moveBook(bookId, category) {
        const book = this.books.find((b) => String(b.id) === String(bookId));
        if (book) {
            book.category = category;
            this.renderBooks();
            this.updateCategoryCounts();
        }
    }

    renderCategories() {
        const categoriesDiv = document.querySelector('.categories');
        categoriesDiv.innerHTML = '';

        const allCategoriesData = [
            { id: 'all', name: '全部' },
            { id: 'reading', name: '阅读中' },
            { id: 'finished', name: '已完成' },
            ...this.categories
        ];

        allCategoriesData.forEach((cat) => {
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'category';
            categoryDiv.dataset.category = cat.id;

            const header = document.createElement('div');
            header.className = 'category-header';
            header.innerHTML = `${cat.name}<span class="book-count">0</span>`;

            header.addEventListener('click', () => this.selectCategory(cat.id));
            categoryDiv.appendChild(header);
            categoriesDiv.appendChild(categoryDiv);
        });

        this.selectCategory(this.currentCategory);
    }

    selectCategory(categoryId) {
        this.currentCategory = categoryId;
        document.querySelectorAll('.category-header').forEach((h) => {
            h.classList.remove('active');
        });
        document.querySelector(`[data-category="${categoryId}"] .category-header`)?.classList.add('active');
        this.renderBooks();
    }

    renderBooks() {
        const booksList = document.getElementById('booksList');
        booksList.innerHTML = '';

        let filteredBooks = this.books;
        if (this.currentCategory !== 'all') {
            filteredBooks = this.books.filter((b) => b.category === this.currentCategory);
        }

        if (filteredBooks.length === 0) {
            booksList.innerHTML = '<div style="padding: 8px; text-align: center; color: rgba(255,255,255,0.7); font-size: 0.8rem;">暂无书籍</div>';
            return;
        }

        filteredBooks.forEach((book) => {
            const bookId = String(book.id);
            const bookItem = document.createElement('div');
            bookItem.className = 'book-item';
            bookItem.dataset.bookId = bookId;

            const nameSpan = document.createElement('span');
            nameSpan.className = 'book-item-name';
            nameSpan.title = book.name;
            nameSpan.textContent = book.name;

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'book-item-actions';

            const finishBtn = document.createElement('button');
            finishBtn.className = 'book-item-action';
            finishBtn.title = '标记完成';
            finishBtn.textContent = '✓';
            finishBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.moveBook(book.id, 'finished');
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'book-item-action';
            deleteBtn.title = '删除';
            deleteBtn.textContent = '✕';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteBook(book.id);
            });

            actionsDiv.appendChild(finishBtn);
            actionsDiv.appendChild(deleteBtn);
            bookItem.appendChild(nameSpan);
            bookItem.appendChild(actionsDiv);

            if (this.currentBook && String(this.currentBook.id) === bookId) {
                bookItem.classList.add('active');
            }

            bookItem.addEventListener('click', () => this.selectBook(book.id));
            booksList.appendChild(bookItem);
        });

        this.updateCategoryCounts();
    }

    updateCategoryCounts() {
        const counts = {
            all: this.books.length,
            reading: this.books.filter((b) => b.category === 'reading').length,
            finished: this.books.filter((b) => b.category === 'finished').length
        };

        document.querySelectorAll('.category').forEach((cat) => {
            const id = cat.dataset.category;
            const count = counts[id] || 0;
            const countSpan = cat.querySelector('.book-count');
            if (countSpan) {
                countSpan.textContent = count;
            }
        });
    }

    addCategory(name) {
        const newCategory = {
            id: 'cat_' + Date.now(),
            name: name
        };
        this.categories.push(newCategory);
        this.renderCategories();
    }
}

// 全局实例
let bookshelf;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    bookshelf = new BookShelf();
});

// 模态框函数
function showCategoryModal() {
    document.getElementById('categoryModal').classList.add('show');
    document.getElementById('categoryInput').focus();
}

function closeCategoryModal() {
    document.getElementById('categoryModal').classList.remove('show');
    document.getElementById('categoryInput').value = '';
}

function addCategory() {
    const name = document.getElementById('categoryInput').value.trim();
    if (name) {
        bookshelf.addCategory(name);
        closeCategoryModal();
    } else {
        alert('请输入分类名称');
    }
}

document.getElementById('categoryInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addCategory();
});
