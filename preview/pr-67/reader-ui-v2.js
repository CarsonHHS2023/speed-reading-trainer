(function (root, factory) {
    const api = factory(
        root && root.ReaderApiV2,
        root && root.ReaderModelV2,
        root && root.ReaderPresentationV2,
        root && root.ReaderAssetRendererV2,
        root && root.ReaderFindV2,
        root && root.ReaderResumeV2,
    );
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderUIV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ReaderApi, Model, Presentation, Assets, Find, Resume) {
    'use strict';

    const NODE_LIMIT = 150;
    const FIND_RESULT_LIMIT = 200;

    function resolveDeps() {
        if (typeof require === 'function') {
            ReaderApi = ReaderApi || require('./reader-api.js');
            Model = Model || require('./reader-model.js');
            Presentation = Presentation || require('./reader-presentation.js');
            Assets = Assets || require('./reader-assets.js');
            Find = Find || require('./reader-find.js');
            Resume = Resume || require('./reader-resume.js');
        }
        if (!ReaderApi || !Model || !Presentation || !Assets || !Find || !Resume) throw new Error('Reader v2 UI dependencies are required');
        return { ReaderApi, Model, Presentation, Assets, Find, Resume };
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
            this.assets = deps.Assets;
            this.finder = deps.Find;
            this.resume = deps.Resume;
            this.resumeStore = options.resumeStore || new deps.Resume.ReaderResumeStoreV2({ storage: options.resumeStorage });
            this.assetResolver = options.assetResolver || new deps.Assets.ReaderAssetResolverV2({ api: this.api });
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
            this.findQuery = '';
            this.findResults = [];
            this.findIndex = -1;
            this.findTruncated = false;
            this.findGeneration = (this.findGeneration || 0) + 1;
            this.lastLocation = null;
            this.resumeRecord = null;
            this.assetResolver?.reset?.();
            const input = this.element('readerV2FindInput');
            if (input) input.value = '';
            this.updateFindControls();
        }

        element(id) {
            return this.document ? this.document.getElementById(id) : null;
        }

        clear(el) {
            while (el && el.firstChild) el.removeChild(el.firstChild);
        }

        presentationOptions() {
            const main = this.document?.querySelector('.reader-v2-main');
            return {
                lineWidth: Number(this.element('widthInput')?.value || 35),
                maxLines: Number(this.element('maxLinesInput')?.value || 20),
                fontSize: Number(this.element('fontInput')?.value || 28),
                viewportWidth: Number(main?.clientWidth || 700),
            };
        }

        activateReaderSurface() {
            if (this.document?.body) this.document.body.dataset.readerV2Active = '1';
            const reader = this.element('readerV2Display');
            const focus = this.element('focusModeDisplay');
            const page = this.element('pageModeDisplay');
            const chart = this.element('chartDisplay');
            if (focus) focus.classList.remove('active');
            if (page) page.classList.remove('active');
            if (chart) chart.classList.remove('active');
            if (reader) reader.classList.add('active');
            const start = this.element('readingToggleBtn');
            if (start) start.disabled = true;
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
                await this.restoreResumeLocation();
                return opened;
            } catch (error) {
                this.renderError(error);
                throw error;
            }
        }

        async loadMore(options = {}) {
            if (!this.documentRef || !this.candidateId) return null;
            if (!options.silent) this.setStatus('正在加载内容…');
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
            if (!options.deferRender) this.reflowAndRender();
            const button = this.element('readerV2LoadMore');
            if (button) button.hidden = !this.hasMore;
            if (!options.silent) this.setStatus('');
            return chunk;
        }

        reflowAndRender() {
            if (!this.openResponse) return;
            this.activateReaderSurface();
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

        locationForNode(nodeId) {
            const node = this.model.findNodeById(this.nodes, nodeId);
            if (!node) return null;
            return node.location || {
                document_ref: this.documentRef,
                candidate_id: this.candidateId,
                contract_version: this.openResponse?.contract_version || '2',
                candidate_schema_id: this.openResponse?.candidate_schema_id,
                candidate_schema_version: this.openResponse?.candidate_schema_version,
                node_id: node.node_id,
                source_unit_id: node.source_unit_ids?.[0] || null,
                source_anchor: node.source_anchors?.[0] || null,
            };
        }

        persistLocation(location, extra = {}) {
            if (!this.openResponse || !location?.node_id) return null;
            this.lastLocation = location;
            const record = this.resume.recordForLocation(this.openResponse, location, extra);
            if (!record) return null;
            this.resumeRecord = this.resumeStore.write(record) || record;
            return this.resumeRecord;
        }

        persistCurrentLocation(extra = {}) {
            const location = extra.location || this.lastLocation;
            if (!location) return null;
            return this.persistLocation(location, extra);
        }

        clearResume(documentRef = this.documentRef) {
            if (documentRef) this.resumeStore.clear(documentRef);
            if (String(documentRef || '') === String(this.documentRef || '')) this.resumeRecord = null;
        }

        async ensureNodeLoaded(nodeId) {
            if (!nodeId) return null;
            let node = this.model.findNodeById(this.nodes, nodeId);
            while (!node && this.hasMore) {
                await this.loadMore({ silent: true, deferRender: true });
                node = this.model.findNodeById(this.nodes, nodeId);
            }
            if (node) this.reflowAndRender();
            return node;
        }

        async restoreResumeLocation() {
            if (!this.documentRef || !this.openResponse) return null;
            const record = this.resumeStore.read(this.documentRef);
            if (!record) return null;
            if (!this.resume.sameCandidate(record, this.openResponse)) {
                this.resumeStore.clear(this.documentRef);
                return null;
            }
            const node = await this.ensureNodeLoaded(record.node_id);
            if (!node) {
                this.resumeStore.clear(this.documentRef);
                return null;
            }
            this.resumeRecord = record;
            const location = node.location || record;
            this.lastLocation = location;
            this.navigateTo(location, { persist: false });
            this.setStatus('已恢复上次阅读位置。');
            return record;
        }

        navigateTo(location, options = {}) {
            const nodeId = location?.node_id;
            if (!nodeId) return;
            const nodeEl = this.document.querySelector(`[data-reader-node-id="${escapeSelector(nodeId)}"]`);
            if (nodeEl) {
                nodeEl.scrollIntoView({ block: 'center', behavior: options.behavior || 'smooth' });
                nodeEl.focus({ preventScroll: true });
                const resolved = this.locationForNode(nodeId) || location;
                this.lastLocation = resolved;
                if (options.persist !== false) this.persistLocation(resolved);
                return;
            }
            if (this.hasMore) {
                this.loadMore().then(() => this.navigateTo(location, options)).catch((error) => this.renderError(error));
            }
        }

        currentFindResult() {
            if (this.findIndex < 0 || this.findIndex >= this.findResults.length) return null;
            const result = this.findResults[this.findIndex];
            return this.finder.sameCandidate(result, this.openResponse) ? result : null;
        }

        clearFind(options = {}) {
            this.findGeneration += 1;
            this.findQuery = '';
            this.findResults = [];
            this.findIndex = -1;
            this.findTruncated = false;
            if (options.clearInput !== false) {
                const input = this.element('readerV2FindInput');
                if (input) input.value = '';
            }
            this.updateFindControls();
            if (options.render !== false && this.openResponse) this.reflowAndRender();
        }

        updateFindControls() {
            const count = this.element('readerV2FindCount');
            const prev = this.element('readerV2FindPrev');
            const next = this.element('readerV2FindNext');
            const hasResults = this.findResults.length > 0;
            if (count) {
                const position = hasResults ? this.findIndex + 1 : 0;
                const suffix = this.findTruncated ? '+' : '';
                count.textContent = `${position} / ${this.findResults.length}${suffix}`;
                count.title = this.findTruncated ? `最多显示前 ${FIND_RESULT_LIMIT} 个结果` : '';
            }
            if (prev) prev.disabled = !hasResults;
            if (next) next.disabled = !hasResults;
        }

        async runFind(query) {
            const normalized = this.finder.normalizeQuery(query);
            const generation = ++this.findGeneration;
            this.findQuery = normalized;
            this.findResults = [];
            this.findIndex = -1;
            this.findTruncated = false;
            if (!normalized || !this.openResponse) {
                this.updateFindControls();
                if (this.openResponse) this.reflowAndRender();
                return [];
            }

            this.setStatus('正在查找…');
            try {
                let search = this.finder.findInNodes(this.openResponse, this.nodes, normalized, { maxResults: FIND_RESULT_LIMIT });
                while (generation === this.findGeneration && this.hasMore && search.results.length < FIND_RESULT_LIMIT && !search.truncated) {
                    await this.loadMore({ silent: true, deferRender: true });
                    search = this.finder.findInNodes(this.openResponse, this.nodes, normalized, { maxResults: FIND_RESULT_LIMIT });
                }
                if (generation !== this.findGeneration) return [];

                this.findResults = search.results;
                this.findTruncated = Boolean(search.truncated || (this.hasMore && search.results.length >= FIND_RESULT_LIMIT));
                this.findIndex = this.findResults.length ? 0 : -1;
                this.updateFindControls();
                this.reflowAndRender();
                const active = this.currentFindResult();
                if (active) this.navigateTo({ node_id: active.node_id });
                this.setStatus(this.findResults.length ? '' : '没有找到匹配内容。');
                return this.findResults;
            } catch (error) {
                if (generation === this.findGeneration) this.renderError(error);
                throw error;
            }
        }

        navigateFind(delta) {
            if (!this.findResults.length) return;
            const nextIndex = (this.findIndex + Number(delta) + this.findResults.length) % this.findResults.length;
            this.findIndex = nextIndex;
            const active = this.currentFindResult();
            if (!active) {
                this.clearFind({ clearInput: false });
                return;
            }
            this.updateFindControls();
            this.reflowAndRender();
            this.navigateTo({ node_id: active.node_id });
        }

        appendHighlightedText(parent, text, node) {
            const active = this.currentFindResult();
            if (!active || active.node_id !== node.node_id) {
                parent.textContent = text || '';
                return;
            }
            const before = String(text || '').slice(0, active.match_start);
            const match = String(text || '').slice(active.match_start, active.match_end);
            const after = String(text || '').slice(active.match_end);
            if (before) parent.appendChild(createElement(this.document, 'span', '', before));
            parent.appendChild(createElement(this.document, 'mark', 'reader-v2-find-highlight', match));
            if (after) parent.appendChild(createElement(this.document, 'span', '', after));
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

        renderSemanticAsset(node, wrapper) {
            const target = createElement(this.document, 'div', 'reader-v2-asset-slot');
            target.appendChild(createElement(this.document, 'div', 'reader-v2-placeholder', node.text || this.assets.defaultLabel(node.node_type)));
            wrapper.appendChild(target);
            this.assets.renderAssetInto({
                documentObject: this.document,
                resolver: this.assetResolver,
                documentRef: this.documentRef,
                candidateId: this.candidateId,
                assetRefs: node.asset_refs || [],
                nodeType: node.node_type,
                fallbackText: node.text,
                target,
            }).catch((error) => {
                if (error?.code === 'reader_selection_changed' || error?.code === 'reader_identity_changed') {
                    this.renderError(error);
                    return;
                }
                this.setStatus('部分图像资源暂时不可用。', 'info');
            });
        }

        renderNode(node) {
            const wrapper = createElement(this.document, 'article', `reader-v2-node reader-v2-node-${node.node_type || 'unknown'}`);
            wrapper.dataset.readerNodeId = node.node_id;
            wrapper.tabIndex = -1;
            const tag = this.model.nodeTag(node);
            if (['table', 'figure', 'formula'].includes(node.node_type)) {
                this.renderSemanticAsset(node, wrapper);
                if (node.text && this.currentFindResult()?.node_id === node.node_id) {
                    const text = createElement(this.document, 'div', 'reader-v2-find-asset-text');
                    this.appendHighlightedText(text, node.text, node);
                    wrapper.appendChild(text);
                }
            } else if (node.node_type === 'list') {
                const list = createElement(this.document, 'ul', 'reader-v2-list');
                if (node.text) {
                    const item = createElement(this.document, 'li', '');
                    this.appendHighlightedText(item, node.text, node);
                    list.appendChild(item);
                }
                wrapper.appendChild(list);
            } else {
                const text = createElement(this.document, tag, 'reader-v2-node-text');
                this.appendHighlightedText(text, node.text || '', node);
                wrapper.appendChild(text);
            }
            if (node.content_state && node.content_state !== 'ready') {
                wrapper.appendChild(createElement(this.document, 'span', 'reader-v2-state', node.content_state));
            }
            return wrapper;
        }

        renderError(error) {
            this.activateReaderSurface();
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
            const findInput = this.element('readerV2FindInput');
            const findButton = this.element('readerV2FindButton');
            const findPrev = this.element('readerV2FindPrev');
            const findNext = this.element('readerV2FindNext');
            if (findInput && !findInput.dataset.readerV2FindBound) {
                findInput.dataset.readerV2FindBound = '1';
                findInput.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') this.runFind(findInput.value).catch(() => {});
                    if (event.key === 'Escape') this.clearFind();
                });
                findInput.addEventListener('input', () => {
                    if (!findInput.value.trim()) this.clearFind({ clearInput: false });
                });
            }
            if (findButton && !findButton.dataset.readerV2FindBound) {
                findButton.dataset.readerV2FindBound = '1';
                findButton.addEventListener('click', () => this.runFind(findInput?.value || '').catch(() => {}));
            }
            if (findPrev && !findPrev.dataset.readerV2FindBound) {
                findPrev.dataset.readerV2FindBound = '1';
                findPrev.addEventListener('click', () => this.navigateFind(-1));
            }
            if (findNext && !findNext.dataset.readerV2FindBound) {
                findNext.dataset.readerV2FindBound = '1';
                findNext.addEventListener('click', () => this.navigateFind(1));
            }
            for (const id of ['widthInput', 'widthSlider', 'maxLinesInput', 'maxLinesSlider', 'fontInput', 'fontSlider']) {
                const el = this.element(id);
                if (el && !el.dataset.readerV2Bound) {
                    el.dataset.readerV2Bound = '1';
                    el.addEventListener('input', () => this.reflowAndRender());
                    el.addEventListener('change', () => this.reflowAndRender());
                }
            }
            if (typeof window !== 'undefined' && !window.__readerV2ResizeBound) {
                window.__readerV2ResizeBound = true;
                window.addEventListener('resize', () => this.reflowAndRender());
            }
            this.updateFindControls();
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

    return { FIND_RESULT_LIMIT, ReaderV2Controller, getDefaultController, openBook, safeMessage };
});