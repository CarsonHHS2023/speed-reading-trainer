(function (root) {
    'use strict';

    function install() {
        if (typeof BookShelf === 'undefined' || !BookShelf.prototype) return false;
        const prototype = BookShelf.prototype;
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
                }
            };
        }
        return true;
    }

    install();

    if (typeof module === 'object' && module.exports) module.exports = { install };
    if (root) root.ReaderResumeLifecycleV2 = { install };
})(typeof globalThis !== 'undefined' ? globalThis : this);