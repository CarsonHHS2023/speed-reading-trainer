(function (root, factory) {
    const api = factory(root && root.ReaderUIV2, root && root.ReaderAnnotationsV2);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderAnnotationsUIV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ReaderUI, Annotations) {
    'use strict';

    function resolveDeps() {
        if (typeof require === 'function') {
            ReaderUI = ReaderUI || require('./reader-ui-v2.js');
            Annotations = Annotations || require('./reader-annotations.js');
        }
        if (!ReaderUI || !Annotations) throw new Error('Reader v2 annotation dependencies are required');
        return { ReaderUI, Annotations };
    }

    function createElement(documentObject, tag, className, text) {
        const el = documentObject.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined && text !== null) el.textContent = text;
        return el;
    }

    class ReaderAnnotationUIControllerV2 {
        constructor(options = {}) {
            const deps = resolveDeps();
            this.document = options.documentObject || (typeof document !== 'undefined' ? document : null);
            this.reader = options.readerController || deps.ReaderUI.getDefaultController();
            this.annotations = deps.Annotations;
            this.store = options.store || new deps.Annotations.ReaderAnnotationStoreV2({ storage: options.storage });
            this.editingId = null;
            this.openBookPatched = false;
            this.bound = false;
        }

        element(id) {
            return this.document ? this.document.getElementById(id) : null;
        }

        activeLocation() {
            if (this.reader?.lastLocation?.node_id) return this.reader.lastLocation;
            const first = this.reader?.nodes?.[0];
            return first ? this.reader.locationForNode?.(first.node_id) : null;
        }

        currentRecords() {
            return this.reader?.documentRef ? this.store.list(this.reader.documentRef) : [];
        }

        currentCandidateRecords() {
            return this.currentRecords().filter((record) => this.annotations.sameCandidate(record, this.reader?.openResponse));
        }

        bookmarkForLocation(location) {
            if (!location?.node_id) return null;
            return this.currentCandidateRecords().find((record) => record.kind === 'bookmark' && record.node_id === location.node_id) || null;
        }

        toggleBookmark() {
            const location = this.activeLocation();
            if (!location || !this.reader?.openResponse) {
                this.reader?.setStatus?.('请先定位到一个可阅读段落。');
                return null;
            }
            const existing = this.bookmarkForLocation(location);
            if (existing) {
                this.store.remove(existing.document_ref, existing.annotation_id);
                this.reader?.setStatus?.('书签已移除。');
                this.render();
                return null;
            }
            const record = this.annotations.recordForLocation(this.reader.openResponse, location, { kind: 'bookmark' });
            const saved = this.store.upsert(record);
            this.reader?.setStatus?.('书签已保存。');
            this.render();
            return saved;
        }

        beginEdit(record) {
            if (!record || record.kind !== 'note') return;
            if (!this.annotations.sameCandidate(record, this.reader?.openResponse)) {
                this.reader?.setStatus?.('这个笔记属于旧内容版本，不能编辑。', 'info');
                return;
            }
            this.editingId = record.annotation_id;
            const input = this.element('readerV2NoteInput');
            if (input) {
                input.value = record.note_text || '';
                input.focus();
            }
            this.updateEditorState();
        }

        cancelEdit() {
            this.editingId = null;
            const input = this.element('readerV2NoteInput');
            if (input) input.value = '';
            this.updateEditorState();
        }

        saveNote() {
            const input = this.element('readerV2NoteInput');
            const noteText = String(input?.value || '').trim();
            if (!noteText) {
                this.reader?.setStatus?.('请输入笔记内容。');
                return null;
            }
            if (!this.reader?.openResponse) return null;
            const records = this.currentRecords();
            const existing = this.editingId ? records.find((record) => record.annotation_id === this.editingId) : null;
            const location = existing || this.activeLocation();
            if (!location?.node_id) {
                this.reader?.setStatus?.('请先定位到一个可阅读段落。');
                return null;
            }
            if (existing && !this.annotations.sameCandidate(existing, this.reader.openResponse)) {
                this.reader?.setStatus?.('这个笔记属于旧内容版本，不能保存到当前版本。', 'info');
                return null;
            }
            const record = this.annotations.recordForLocation(this.reader.openResponse, location, {
                kind: 'note',
                noteText,
                annotationId: existing?.annotation_id,
                createdAt: existing?.created_at,
            });
            const saved = this.store.upsert(record);
            this.editingId = null;
            if (input) input.value = '';
            this.reader?.setStatus?.(existing ? '笔记已更新。' : '笔记已保存。');
            this.render();
            return saved;
        }

        remove(record) {
            if (!record) return false;
            const removed = this.store.remove(record.document_ref, record.annotation_id);
            if (this.editingId === record.annotation_id) this.cancelEdit();
            this.render();
            return removed;
        }

        async navigate(record) {
            if (!record) return false;
            if (!this.annotations.sameCandidate(record, this.reader?.openResponse)) {
                this.reader?.setStatus?.('这个标注属于旧内容版本，无法导航。', 'info');
                return false;
            }
            const node = await this.reader.ensureNodeLoaded?.(record.node_id);
            if (!node) {
                this.reader?.setStatus?.('标注目标在当前内容中不可用。', 'info');
                return false;
            }
            this.reader.navigateTo?.(node.location || record);
            return true;
        }

        clearDocument(documentRef) {
            this.store.clear(documentRef);
            if (String(documentRef || '') === String(this.reader?.documentRef || '')) {
                this.editingId = null;
                this.render();
            }
        }

        updateEditorState() {
            const save = this.element('readerV2NoteSave');
            const cancel = this.element('readerV2NoteCancel');
            if (save) save.textContent = this.editingId ? '更新笔记' : '保存笔记';
            if (cancel) cancel.hidden = !this.editingId;
        }

        render() {
            const list = this.element('readerV2AnnotationsList');
            const bookmark = this.element('readerV2BookmarkButton');
            if (bookmark) {
                const marked = Boolean(this.bookmarkForLocation(this.activeLocation()));
                bookmark.textContent = marked ? '★ 已加书签' : '☆ 添加书签';
                bookmark.disabled = !this.reader?.openResponse;
            }
            this.updateEditorState();
            if (!list) return;
            while (list.firstChild) list.removeChild(list.firstChild);
            const records = this.currentRecords();
            if (!records.length) {
                list.appendChild(createElement(this.document, 'p', 'reader-v2-annotation-empty', '暂无书签或笔记'));
                return;
            }
            for (const record of records) {
                const current = this.annotations.sameCandidate(record, this.reader?.openResponse);
                const row = createElement(this.document, 'div', `reader-v2-annotation-item${current ? '' : ' is-stale'}`);
                const go = createElement(this.document, 'button', 'reader-v2-annotation-go');
                go.type = 'button';
                const label = record.kind === 'bookmark' ? '★ 书签' : `📝 ${record.note_text}`;
                go.textContent = current ? label : `${label} · 旧版本`;
                go.title = current ? `定位到 ${record.node_id}` : '内容版本已变化';
                go.addEventListener('click', () => this.navigate(record).catch((error) => this.reader?.renderError?.(error)));
                row.appendChild(go);
                if (record.kind === 'note') {
                    const edit = createElement(this.document, 'button', 'reader-v2-annotation-action', '编辑');
                    edit.type = 'button';
                    edit.disabled = !current;
                    edit.addEventListener('click', () => this.beginEdit(record));
                    row.appendChild(edit);
                }
                const remove = createElement(this.document, 'button', 'reader-v2-annotation-action', '删除');
                remove.type = 'button';
                remove.addEventListener('click', () => this.remove(record));
                row.appendChild(remove);
                list.appendChild(row);
            }
        }

        bind() {
            if (this.bound || !this.document) return;
            this.bound = true;
            this.element('readerV2BookmarkButton')?.addEventListener('click', () => this.toggleBookmark());
            this.element('readerV2NoteSave')?.addEventListener('click', () => this.saveNote());
            this.element('readerV2NoteCancel')?.addEventListener('click', () => this.cancelEdit());
            this.element('readerV2NoteInput')?.addEventListener('keydown', (event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') this.saveNote();
                if (event.key === 'Escape') this.cancelEdit();
            });
            this.render();
        }

        patchReaderOpenBook() {
            if (this.openBookPatched) return;
            this.openBookPatched = true;
            const original = ReaderUI.openBook;
            if (typeof original !== 'function') return;
            const self = this;
            ReaderUI.openBook = async function openBookWithAnnotations(book) {
                const result = await original(book);
                self.reader = ReaderUI.getDefaultController();
                self.editingId = null;
                self.render();
                return result;
            };
        }
    }

    let defaultController = null;

    function getDefaultController() {
        if (!defaultController) defaultController = new ReaderAnnotationUIControllerV2();
        return defaultController;
    }

    function install() {
        const controller = getDefaultController();
        controller.patchReaderOpenBook();
        controller.bind();
        return controller;
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
        else install();
    }

    return { ReaderAnnotationUIControllerV2, getDefaultController, install };
});