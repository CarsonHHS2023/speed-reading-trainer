(function (root) {
    'use strict';

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
            script.src = src;
            script.dataset.readerEnhancement = src;
            script.addEventListener('load', () => {
                script.dataset.loaded = '1';
                resolve(globalName ? root[globalName] : true);
            }, { once: true });
            script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
            document.head.appendChild(script);
        });
    }

    function installEnhancements() {
        return loadScript('speed-reading-structure-policy.js', 'SpeedReadingStructurePolicy')
            .then((module) => module?.install?.(root))
            .then(() => loadScript('speed-reading-responsive-layout.js', 'SpeedReadingResponsiveLayout'))
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
                }
            };
        }
        installEnhancements();
        return true;
    }

    install();

    if (typeof module === 'object' && module.exports) module.exports = { install, installEnhancements, loadScript };
    if (root) root.ReaderResumeLifecycleV2 = { install, installEnhancements, loadScript };
})(typeof globalThis !== 'undefined' ? globalThis : this);