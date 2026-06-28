// ==================== 书架管理系统 ====================

class BookShelf {
    constructor() {
        this.books = this.loadBooks();
        this.categories = this.loadCategories();
        this.currentBook = null;
        this.currentCategory = 'all';
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.renderCategories();
        this.renderBooks();
    }

    setupEventListeners() {
        const uploadZone = document.getElementById('uploadZone');
        const fileInput = document.getElementById('fileInput');
        const addCategoryBtn = document.getElementById('addCategoryBtn');

        // 拖拽上传
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
            fileInput.click();
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileUpload(e.target.files[0]);
                // 重置文件输入，以便下次可以选择同一文件
                fileInput.value = '';
            }
        });

        addCategoryBtn.addEventListener('click', () => showCategoryModal());
    }

    async handleFileUpload(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const content = await this.readFile(file, arrayBuffer);
            
            const fileType = file.type === 'application/pdf' ? 'pdf' : 'txt';
            
            const book = {
                id: Date.now(),
                name: file.name,
                content: content,
                fileType: fileType,
                category: 'reading',
                uploadDate: new Date().toLocaleString('zh-CN'),
                progress: 0
            };

            this.books.push(book);
            this.saveBooks();
            this.renderBooks();
            this.updateCategoryCounts();
            this.selectBook(book.id);
        } catch (error) {
            console.error('文件处理错误:', error);
            alert('文件处理失败，请检查文件格式');
        }
    }

    async readFile(file, arrayBuffer) {
        if (file.type === 'text/plain') {
            return await this.decodeText(arrayBuffer);
        } else if (file.type === 'application/pdf') {
            return await this.extractPDFText(arrayBuffer);
        } else {
            throw new Error('不支持的文件类型');
        }
    }

    async decodeText(arrayBuffer) {
        try {
            const decoder = new TextDecoder('utf-8', { fatal: true });
            return decoder.decode(arrayBuffer);
        } catch (e) {
            try {
                const decoder = new TextDecoder('gb2312');
                return decoder.decode(arrayBuffer);
            } catch (e2) {
                const decoder = new TextDecoder('latin1');
                return decoder.decode(arrayBuffer);
            }
        }
    }

    async extractPDFText(arrayBuffer) {
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join('');
            text += pageText + '\n';
        }
        return text;
    }

    selectBook(bookId) {
        this.currentBook = this.books.find(b => b.id === bookId);
        document.querySelectorAll('.book-item').forEach(item => {
            item.classList.remove('active');
        });
        document.querySelector(`[data-book-id="${bookId}"]`)?.classList.add('active');
        
        if (this.currentBook) {
            window.updateBookContent(this.currentBook.fileType);
        }
    }

    deleteBook(bookId) {
        if (confirm('确定要删除这本书吗？')) {
            this.books = this.books.filter(b => b.id !== bookId);
            this.saveBooks();
            this.renderBooks();
            this.updateCategoryCounts();
            
            if (this.currentBook?.id === bookId) {
                this.currentBook = null;
            }
        }
    }

    moveBook(bookId, category) {
        const book = this.books.find(b => b.id === bookId);
        if (book) {
            book.category = category;
            this.saveBooks();
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

        allCategoriesData.forEach(cat => {
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
    }

    selectCategory(categoryId) {
        this.currentCategory = categoryId;
        document.querySelectorAll('.category-header').forEach(h => {
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
            filteredBooks = this.books.filter(b => b.category === this.currentCategory);
        }

        if (filteredBooks.length === 0) {
            booksList.innerHTML = '<div style="padding: 8px; text-align: center; color: rgba(255,255,255,0.7); font-size: 0.8rem;">暂无书籍</div>';
            return;
        }

        filteredBooks.forEach(book => {
            const bookItem = document.createElement('div');
            bookItem.className = 'book-item';
            bookItem.dataset.bookId = book.id;
            bookItem.innerHTML = `
                <span class="book-item-name" title="${book.name}">${book.name}</span>
                <div class="book-item-actions">
                    <button class="book-item-action" onclick="bookshelf.moveBook(${book.id}, 'finished')" title="标记完成">✓</button>
                    <button class="book-item-action" onclick="bookshelf.deleteBook(${book.id})" title="删除">✕</button>
                </div>
            `;
            bookItem.addEventListener('click', (e) => {
                if (!e.target.closest('.book-item-action')) {
                    this.selectBook(book.id);
                }
            });
            booksList.appendChild(bookItem);
        });

        this.updateCategoryCounts();
    }

    updateCategoryCounts() {
        const counts = {
            all: this.books.length,
            reading: this.books.filter(b => b.category === 'reading').length,
            finished: this.books.filter(b => b.category === 'finished').length
        };

        document.querySelectorAll('.category').forEach(cat => {
            const id = cat.dataset.category;
            const count = counts[id] || 0;
            const countSpan = cat.querySelector('.book-count');
            if (countSpan) countSpan.textContent = count;
        });
    }

    addCategory(name) {
        const newCategory = {
            id: 'cat_' + Date.now(),
            name: name
        };
        this.categories.push(newCategory);
        this.saveCategories();
        this.renderCategories();
    }

    saveBooks() {
        localStorage.setItem('speedreader_books', JSON.stringify(this.books));
    }

    loadBooks() {
        const data = localStorage.getItem('speedreader_books');
        return data ? JSON.parse(data) : [];
    }

    saveCategories() {
        localStorage.setItem('speedreader_categories', JSON.stringify(this.categories));
    }

    loadCategories() {
        const data = localStorage.getItem('speedreader_categories');
        return data ? JSON.parse(data) : [];
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
