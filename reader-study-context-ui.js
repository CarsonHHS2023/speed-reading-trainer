(function (root, factory) {
    const api = factory(
        root && root.ReaderUIV2,
        root && root.ReaderAnnotationsV2,
        root && root.ReaderHighlightsV2,
        root && root.ReaderStudyContextV1,
    );
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderStudyContextUIV1 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ReaderUI, Annotations, Highlights, StudyContext) {
    'use strict';

    function resolveDeps() {
        if (typeof require === 'function') {
            ReaderUI = ReaderUI || require('./reader-ui-v2.js');
            Annotations = Annotations || require('./reader-annotations.js');
            Highlights = Highlights || require('./reader-highlights.js');
            StudyContext = StudyContext || require('./reader-study-context.js');
        }
        if (!ReaderUI || !Annotations || !Highlights || !StudyContext) throw new Error('Reader StudyContext UI dependencies are required');
        return { ReaderUI, Annotations, Highlights, StudyContext };
    }

    function createElement(documentObject, tag, className, text) {
        const el = documentObject.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined && text !== null) el.textContent = text;
        return el;
    }

    class ReaderStudyContextUIControllerV1 {
        constructor(options = {}) {
            const deps = resolveDeps();
            this.document = options.documentObject || (typeof document !== 'undefined' ? document : null);
            this.reader = options.readerController || deps.ReaderUI.getDefaultController();
            this.study = deps.StudyContext;
            this.annotationStore = options.annotationStore || new deps.Annotations.ReaderAnnotationStoreV2({ storage: options.storage });
            this.highlightStore = options.highlightStore || new deps.Highlights.ReaderHighlightStoreV2({ storage: options.storage });
            this.bound = false;
            this.lastContext = null;
        }

        element(id) {
            return this.document ? this.document.getElementById(id) : null;
        }

        sourceRecords() {
            const documentRef = this.reader?.documentRef;
            if (!documentRef) return { annotations: [], highlights: [] };
            return {
                annotations: this.annotationStore.list(documentRef),
                highlights: this.highlightStore.list(documentRef),
            };
        }

        async ensureTargetsLoaded(records) {
            if (!this.reader?.openResponse) return;
            const ids = this.study.targetNodeIds(this.reader.openResponse, records.annotations, records.highlights);
            for (const nodeId of ids) await this.reader.ensureNodeLoaded?.(nodeId);
        }

        async build() {
            if (!this.reader?.openResponse) {
                this.reader?.setStatus?.('请先打开一本 Reader v2 文档。');
                this.lastContext = null;
                this.render(null);
                return null;
            }
            const records = this.sourceRecords();
            this.reader?.setStatus?.('正在构建学习上下文…');
            await this.ensureTargetsLoaded(records);
            this.lastContext = this.study.buildStudyContext(
                this.reader.openResponse,
                this.reader.nodes,
                records.annotations,
                records.highlights,
            );
            this.render(this.lastContext);
            this.reader?.setStatus?.('学习上下文已生成。');
            return this.lastContext;
        }

        render(context) {
            const preview = this.element('readerV2StudyContextPreview');
            const stats = this.element('readerV2StudyContextStats');
            if (!preview || !stats) return;
            while (preview.firstChild) preview.removeChild(preview.firstChild);

            if (!context) {
                stats.textContent = '尚未生成';
                preview.appendChild(createElement(this.document, 'p', 'reader-v2-study-empty', '从当前书签、笔记和高亮生成临时 StudyContext。'));
                return;
            }

            const suffix = context.stats.truncated ? '+' : '';
            stats.textContent = `${context.stats.included}${suffix} 项 · ${context.stats.stale_excluded} 个旧版本已排除 · ${context.stats.invalid_excluded} 个无效项已排除`;
            if (!context.items.length) {
                preview.appendChild(createElement(this.document, 'p', 'reader-v2-study-empty', '当前版本没有可加入学习上下文的标注。'));
                return;
            }

            for (const item of context.items) {
                const row = createElement(this.document, 'article', 'reader-v2-study-item');
                const type = item.kind === 'bookmark' ? '书签' : item.kind === 'note' ? '笔记' : '高亮';
                row.appendChild(createElement(this.document, 'strong', 'reader-v2-study-kind', type));
                if (item.note_text) row.appendChild(createElement(this.document, 'div', 'reader-v2-study-note', item.note_text));
                if (item.excerpt) row.appendChild(createElement(this.document, 'div', 'reader-v2-study-excerpt', item.excerpt));
                const identity = createElement(this.document, 'code', 'reader-v2-study-identity', item.node_id);
                row.appendChild(identity);
                preview.appendChild(row);
            }
        }

        reset() {
            this.lastContext = null;
            this.render(null);
        }

        bind() {
            if (this.bound || !this.document) return;
            this.bound = true;
            this.element('readerV2StudyContextBuild')?.addEventListener('click', () => this.build().catch((error) => this.reader?.renderError?.(error)));
            this.render(null);
        }
    }

    let defaultController = null;
    function getDefaultController() {
        if (!defaultController) defaultController = new ReaderStudyContextUIControllerV1();
        return defaultController;
    }

    function install() {
        const controller = getDefaultController();
        controller.bind();
        return controller;
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
        else install();
    }

    return { ReaderStudyContextUIControllerV1, getDefaultController, install };
});