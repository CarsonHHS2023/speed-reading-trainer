(function (root) {
    'use strict';

    if (!root || typeof BookShelf === 'undefined') return;

    function resetLegacyPlaybackState() {
        if (typeof state === 'undefined') return;
        state.content = '';
        state.cachedContentBlob = null;
        state.units = [];
        state.pages = [];
        state.currentIndex = 0;
        state.currentPageIndex = 0;
        state.currentLineIndex = 0;
        state.currentLine = 0;
        state.totalPausedDuration = 0;
        state.isPlaying = false;
        state.isPaused = false;
        state.pendingImageMarkerIndex = null;
        state.imageMarkerMap = {};
        state.isContentLoading = false;
        if (typeof clearReadingTimer === 'function') clearReadingTimer();
        if (typeof updateProgress === 'function') updateProgress();
        if (typeof updateStartButtonState === 'function') updateStartButtonState();
    }

    function refreshReaderV2Playback() {
        root.ReaderSpeedPlaybackUI?.getDefaultController?.().refreshFrames?.({ preserveIdentity: false });
    }

    BookShelf.prototype.selectBook = async function selectBookWithReaderV2(bookId) {
        this.currentBook = this.books.find((book) => String(book.id) === String(bookId)) || null;
        resetLegacyPlaybackState();
        this.renderBooks();

        if (!this.currentBook) {
            root.ReaderUIV2?.getDefaultController?.().reset();
            root.ReaderSpeedPlaybackUI?.getDefaultController?.().stop?.();
            if (typeof resetDisplay === 'function') resetDisplay();
            return;
        }

        this.setLoading(true, '⏳ 正在打开结构化 Reader...');
        try {
            if (!root.ReaderUIV2 || typeof root.ReaderUIV2.openBook !== 'function') {
                throw new Error('Reader v2 UI is unavailable');
            }
            await root.ReaderUIV2.openBook(this.currentBook);
        } catch (error) {
            console.error('打开 Reader v2 失败:', error);
        } finally {
            this.setLoading(false);
            resetLegacyPlaybackState();
            refreshReaderV2Playback();
        }
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
