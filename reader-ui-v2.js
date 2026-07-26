(function (root, factory) {
    const api = factory(root && root.ReaderApiV2, root && root.ReaderModelV2, root && root.ReaderPresentationV2);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderUIV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ReaderApi, Model, Presentation) {
    'use strict';

    const NODE_LIMIT = 150;

    function resolveDeps() {
        if (typeof require === 'function') {
            ReaderApi = ReaderApi || require('./reader-api.js');
            Model = Model || require('./reader-model.js');
            Presentation = Presentation || require('./reader-presentation.js');
        }
        if (!ReaderApi || !Model || !Presentation) throw new Error('Reader v2 UI dependencies are required');
        return { ReaderApi, Model, Presentation };
    }

    function safeMessage(error) {
        const code = error && error.code;
        return {
            reader_not_ready: '这本文档还没有可读取的结构化内容。',
            reader_selection_changed: '阅读内容版本已经变化，请重新打开文档。',
            reader_selection_invalid: '当前选择的阅读内容无效。',
            reader_content_incompatible: '当前内容与 Reader v2 不兼容。',
            reader_network_unavailable: '无法连接阅读服务。',
            reader_contract_version_unsupported: 'Reader API 版本不兼容。',
            reader_candidate_schema_unsupported: '文档内容版本不兼容。',
        }[code] || (error && error.safeMessage) || 'Reader v2 暂时无法打开这本文档。';
    }

    function createElement(documentObject, tag, className, text) {
        const el = documentObject.createElement(tag);
        if (className) el.className = className;
        if (text !== undefined && text !== null) el.textContent = text;
        return el;
    }

    class ReaderV2Controller {
        constructor(options = {}) {
            const deps = resolveDeps();
            this.document = options.documentObject || (typeof document !== 'undefined' ? document : null);
            this.api = options.api || new deps.ReaderApi.ReaderApiClientV2(options.apiOptions || {});
            this.model = deps.Model;
            this.presentation = deps.Presentation;
            this.reset();
        }

        reset() {
            this.documentRef = null;
            this.candidateId = null;
            this.openResponse = null;
            this.navigation = [];
            this.nodes = [];
            this.hasMore = false;
            this.nextNodeOrder = 0;
            this.presentationState = { mode: 'reflow', pages: [] };
        }

        element(id) {
            return this.document ? this.document.getElementById(id) : null;
        }

        clear(el) {
            while (el && el.firstChild) el.removeChild(el.firstChild);
        }

        presentationOptions() {
            return {
                lineWidth: Number(this.element('widthInput')?.value || 35),
                maxLines: Number(this.element('maxLinesInput')?.value || 20),
            };
        }

        activateReaderSurface() {
            const reader = this.element('readerV2Display');
            const focus = this.element('focusModeDisplay');
            const page = this.element('pageModeDisplay');
            const chart = this.element('chartDisplay');
            if (focus) focus.classList.remove('active');
            if (page) page.classList.remove('active');
            if (chart) chart.classList.remove('active');
            if (reader) reader.classList.add('active');
            const start = this.element('readingToggleBtn');
            if (start) {
                start.disabled = true;
                start.title = 'Reader v2 已启用；速度播放将在 SpeedReadingAdapter 阶段接入';
            }
        }

        setStatus(message, kind = 'info') {
            const el = this.element('readerV2Status');
            if (!el) return;
            el.textContent = message || '';
            el.dataset.kind = kind;
        }

        async openBook(book) {
            this.reset();
            this.documentRef = String(book && book.id !== undefined ? book.id : book);
            this.activateReaderSurface();
            this.setStatus('正在打开 Reader v2…');
            this.clear(this.element('readerV2Navigation'));
            this.clear(this.element('readerV2Pages'));
            try {
                const opened = await this.api.open(this.documentRef);
                this.openResponse = opened;
                this.candidateId = opened.candidate_id;
                const navigationResponse = await this.api.navigation(this.documentRef, { candidateId: this.candidateId });
                this.navigation = navigationResponse.navigation || [];
                this.renderHeader(book);
                this.renderNavigation();
                await this.loadMore({ replace: true });
                return opened;
            } catch (error) {
                this.renderError(error);
                throw error;
            }
        }

        async loadMore(options = {}) {
            if (!this.documentRef || !this.candidateId) return null;
            this.setStatus('正在加载内容…');
            const chunk = await this.api.content(this.documentRef, {
                candidateId: this.candidateId,
                startNodeOrder: options.replace ? 0 : this.nextNodeOrder,
                limit: NODE_LIMIT,
            });
            this.nodes = options.replace
                ? this.model.orderedNodes(chunk.nodes || [])
                : this.model.mergeNodes(this.nodes, chunk.nodes || []);
            this.hasMore = Boolean(chunk.has_more);
            this.nextNodeOrder = chunk.next_node_order == null ? this.nodes.length : Number(chunk.next_node_order);
            this.reflowAndRender();
            const button = this.element('readerV2LoadMore');
            if (button) button.hidden = !this.hasMore;
            this.setStatus('');
            return chunk;
        }

        reflowAndRender() {
            if (!this.openResponse) return;
            this.presentationState = this.presentation.presentationForDocument(
                this.openResponse,
                this.nodes,
                this.presentationOptions(),
            );
            this.renderPages();
        }

        renderHeader(book) {
            const title = this.element('readerV2Title');
            if (title) title.textContent = book?.name || '结构化阅读';
            const meta = this.element('readerV2Meta');
            if (meta) {
                const m = this.openResponse?.metadata || {};
                const mode = Number(m.physical_page_count || 0) > 0 ? 'PDF 原始页' : '动态重排';
                meta.textContent = `${mode} · ${Number(m.source_unit_count || 0)} source units`;
            }
        }

        renderNavigation() {
            const nav = this.element('readerV2Navigation');
            if (!nav) return;
            this.clear(nav);
            for (const entry of this.navigation) {
                const button = createElement(this.document, 'button', 'reader-v2-nav-item', entry.label || '未命名标题');
                button.type = 'button';
                button.style.setProperty('--reader-level', String(Math.max(0, Number(entry.heading_level || 1) - 1)));
                button.addEventListener('click', () => this.navigateTo(entry.location));
                nav.appendChild(button);
            }
            if (!this.navigation.length) nav.appendChild(createElement(this.document, 'p', 'reader-v2-empty', '没有标题导航'));
        }

        navigateTo(location) {
            const nodeId = location?.node_id;
            if (!nodeId) return;
            const nodeEl = this.document.querySelector(`[data-reader-node-id="${escapeSelector(nodeId)}"]`);
            if (nodeEl) {
                nodeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
                nodeEl.focus({ preventScroll: true });
                return;
            }
            if (this.hasMore) {
                this.loadMore().then(() => this.navigateTo(location)).catch((error) => this.renderError(error));
            }
        }

        renderPages() {
            const container = this.element('readerV2Pages');
            if (!container) return;
            this.clear(container);
            for (const page of this.presentationState.pages) {
                const section = createElement(this.document, 'section', `reader-v2-page reader-v2-page-${page.kind}`);
                section.dataset.presentationId = page.presentation_id;
                if (page.kind === 'physical_page') {
                    section.appendChild(createElement(this.document, 'div', 'reader-v2-page-label', `第 ${Number(page.source_order) + 1} 页`));
                }
                for (const node of page.nodes || []) section.appendChild(this.renderNode(node));
                container.appendChild(section);
            }
            if (!this.presentationState.pages.length) {
                container.appendChild(createElement(this.document, 'p', 'reader-v2-empty', '当前文档没有可显示的语义内容。'));
            }
        }

        renderNode(node) {
            const wrapper = createElement(this.document, 'article', `reader-v2-node reader-v2-node-${node.node_type || 'unknown'}`);
            wrapper.dataset.readerNodeId = node.node_id;
            wrapper.tabIndex = -1;
            const tag = this.model.nodeTag(node);
            if (node.node_type === 'table') {
                wrapper.appendChild(createElement(this.document, 'div', 'reader-v2-placeholder', node.text || '表格'));
            } else if (node.node_type === 'figure') {
                wrapper.appendChild(createElement(this.document, 'div', 'reader-v2-placeholder', node.text || '图像'));
            } else if (node.node_type === 'list') {
                const list = createElement(this.document, 'ul', 'reader-v2-list');
                if (node.text) list.appendChild(createElement(this.document, 'li', '', node.text));
                wrapper.appendChild(list);
            } else {
                wrapper.appendChild(createElement(this.document, tag, 'reader-v2-node-text', node.text || ''));
            }
            if (node.content_state && node.content_state !== 'ready') {
                wrapper.appendChild(createElement(this.document, 'span', 'reader-v2-state', node.content_state));
            }
            return wrapper;
        }

        renderError(error) {
            this.setStatus(safeMessage(error), 'error');
            const container = this.element('readerV2Pages');
            if (container) {
                this.clear(container);
                container.appendChild(createElement(this.document, 'div', 'reader-v2-error', safeMessage(error)));
            }
        }

        bindControls() {
            const more = this.element('readerV2LoadMore');
            if (more && !more.dataset.bound) {
                more.dataset.bound = '1';
                more.addEventListener('click', () => this.loadMore().catch((error) => this.renderError(error)));
            }
            for (const id of ['widthInput', 'widthSlider', 'maxLinesInput', 'maxLinesSlider', 'fontInput', 'fontSlider']) {
                const el = this.element(id);
                if (el && !el.dataset.readerV2Bound) {
                    el.dataset.readerV2Bound = '1';
                    el.addEventListener('input', () => this.reflowAndRender());
                    el.addEventListener('change', () => this.reflowAndRender());
                }
            }
        }
    }

    function escapeSelector(value) {
        if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(value));
        return String(value).replace(/["\\]/g, '\\$&');
    }

    let defaultController = null;

    function getDefaultController() {
        if (!defaultController) {
            defaultController = new ReaderV2Controller();
            defaultController.bindControls();
        }
        return defaultController;
    }

    async function openBook(book) {
        return getDefaultController().openBook(book);
    }

    return { ReaderV2Controller, getDefaultController, openBook, safeMessage };
});
