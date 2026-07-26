from __future__ import annotations

import re
from pathlib import Path

path = Path("bookshelf.js")
source = path.read_text(encoding="utf-8")

select_pattern = re.compile(
    r"\n    async selectBook\(bookId\) \{.*?\n    \}\n\n    async deleteBook\(bookId\) \{",
    re.S,
)

replacement = r'''
    resetReaderV2Session() {
        const playback = globalThis.ReaderSpeedPlaybackUI?.getDefaultController?.();
        playback?.stop?.();

        const reader = globalThis.ReaderUIV2?.getDefaultController?.();
        reader?.reset?.();

        if (document.body) {
            delete document.body.dataset.readerV2Active;
        }
        const readerDisplay = document.getElementById('readerV2Display');
        readerDisplay?.classList.remove('active');
        const navigation = document.getElementById('readerV2Navigation');
        const pages = document.getElementById('readerV2Pages');
        const status = document.getElementById('readerV2Status');
        if (navigation) navigation.replaceChildren();
        if (pages) pages.replaceChildren();
        if (status) {
            status.textContent = '';
            status.dataset.kind = 'info';
        }
        playback?.refreshFrames?.({ preserveIdentity: false });
    }

    async selectBook(bookId) {
        this.currentBook = this.books.find((book) => String(book.id) === String(bookId)) || null;
        this.renderBooks();

        const playback = globalThis.ReaderSpeedPlaybackUI?.getDefaultController?.();
        playback?.stop?.();

        if (!this.currentBook) {
            this.resetReaderV2Session();
            return;
        }

        this.setLoading(true, '⏳ 正在打开结构化 Reader...');
        try {
            if (!globalThis.ReaderUIV2 || typeof globalThis.ReaderUIV2.openBook !== 'function') {
                throw new Error('Reader v2 UI is unavailable');
            }
            await globalThis.ReaderUIV2.openBook(this.currentBook);
        } catch (error) {
            console.error('打开 Reader v2 失败:', error);
            globalThis.ReaderUIV2?.getDefaultController?.().renderError?.(error);
        } finally {
            this.setLoading(false);
        }
    }

    async deleteBook(bookId) {'''

source, count = select_pattern.subn(replacement, source, count=1)
if count != 1:
    raise SystemExit(f"expected to replace one selectBook block, replaced {count}")

legacy_delete_reset = re.compile(
    r"\n            if \(this\.currentBook && String\(this\.currentBook\.id\) === String\(bookId\)\) \{.*?\n            \}\n\n            this\.ensureCategoryIntegrity\(\);",
    re.S,
)
replacement_delete_reset = r'''
            if (this.currentBook && String(this.currentBook.id) === String(bookId)) {
                this.currentBook = null;
                this.resetReaderV2Session();
            }

            this.ensureCategoryIntegrity();'''
source, count = legacy_delete_reset.subn(replacement_delete_reset, source, count=1)
if count != 1:
    raise SystemExit(f"expected to replace one delete reset block, replaced {count}")

for forbidden in (
    "/api/v1/books/${encodeURIComponent(bookId)}/content",
    "cachedContentBlob",
    "state.content",
    "imageMarkerMap",
):
    if forbidden in source[source.index("    async selectBook(bookId)"):source.index("    moveBookToCategory(")]:
        raise SystemExit(f"selected-book/delete path still contains forbidden legacy dependency: {forbidden}")

path.write_text(source, encoding="utf-8")
