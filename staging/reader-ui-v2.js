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
    const MAX_VISIBLE_WINDOWS = 2;
    const FIND_RESULT_LIMIT = 200;
    const AUTO_LOAD_THRESHOLD_PX = 600;
    const AUTO_LOAD_MIN_SCROLL_ADVANCE_PX = 120;

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

    function windowStartForOrder(order) {
        const normalized = Math.max(0, Math.trunc(Number(order) || 0));
        return Math.floor(normalized / NODE_LIMIT) * NODE_LIMIT;
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
            this.contentWindows = new Map();
            this.visibleWindowStarts = [];
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
            this.navigationPending = false;
            this.opening = false;
            this.autoLoadPromise = null;
            this.autoLoadScrollTop = null;
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
        }

        setStatus(message, kind = 'info') {
            const el = this.element('readerV2Status');
            if (!el) return;
            el.textContent = message || '';
            el.dataset.kind = kind;
        }

        visibleStarts() {
            return [...new Set(this.visibleWindowStarts || [])]
                .filter((value) => Number.isInteger(value) && value >= 0)
                .sort((a, b) => a - b);
        }

        windowRecord(start) {
            return this.contentWindows.get(Number(start)) || null;
        }

        cachedNode(nodeId) {
            const visible = this.model.findNodeById(this.nodes, nodeId);
            if (visible) return visible;
            for (const record of this.contentWindows.values()) {
                const found = this.model.findNodeById(record.nodes || [], nodeId);
                if (found) return found;
            }
            return null;
        }

        nodeOrder(nodeId) {
            const order = Number(this.cachedNode(nodeId)?.order);
            return Number.isInteger(order) && order >= 0 ? order : null;
        }

        async requestWindow(start, options = {}) {
            if (!this.documentRef || !this.candidateId) return null;
            const normalizedStart = windowStartForOrder(start);
            if (options.cache !== false && options.force !== true && this.contentWindows.has(normalizedStart)) {
                return this.contentWindows.get(normalizedStart);
            }
            const chunk = await this.api.content(this.documentRef, {
                candidateId: this.candidateId,
                startNodeOrder: normalizedStart,
                limit: NODE_LIMIT,
            });
            const record = Object.freeze({
                start: normalizedStart,
                nodes: this.model.orderedNodes(chunk?.nodes || []),
                hasMore: Boolean(chunk?.has_more),
                nextNodeOrder: chunk?.next_node_order == null ? null : Number(chunk.next_node_order),
            });
            if (options.cache !== false) this.contentWindows.set(normalizedStart, record);
            return record;
        }

        rebuildVisibleNodes(options = {}) {
            let nodes = [];
            const starts = this.visibleStarts();
            for (const start of starts) {
                const record = this.windowRecord(start);
                if (!record?.nodes?.length) continue;
                nodes = this.model.mergeNodes(nodes, record.nodes);
            }
            this.nodes = this.model.orderedNodes(nodes);
            const tail = starts.length ? this.windowRecord(starts[starts.length - 1]) : null;
            this.hasMore = Boolean(tail?.hasMore);
            this.nextNodeOrder = tail?.nextNodeOrder == null
                ? (tail ? tail.start + tail.nodes.length : 0)
                : Number(tail.nextNodeOrder);
            const button = this.element('readerV2LoadMore');
            if (button) button.hidden = !this.hasMore;
            if (options.render !== false) {
                this.reflowAndRender();
                if (options.anchorNodeId) {
                    this.scrollLoadedNode(options.anchorNodeId, {
                        persist: false,
                        focus: false,
                        block: options.anchorBlock || 'start',
                        behavior: 'auto',
                    });
                }
            }
            return this.nodes;
        }

        setVisibleWindows(starts, options = {}) {
            const normalized = [...new Set((starts || []).map(windowStartForOrder))]
                .filter((start) => this.contentWindows.has(start))
                .sort((a, b) => a - b);
            this.visibleWindowStarts = normalized.length > MAX_VISIBLE_WINDOWS
                ? normalized.slice(normalized.length - MAX_VISIBLE_WINDOWS)
                : normalized;
            return this.rebuildVisibleNodes(options);
        }

        async loadWindowPair(start, options = {}) {
            const first = await this.requestWindow(start);
            const starts = [];
            if (first?.nodes?.length) starts.push(first.start);
            if (first?.hasMore) {
                const second = await this.requestWindow(first.start + NODE_LIMIT);
                if (second?.nodes?.length) starts.push(second.start);
            }
            this.setVisibleWindows(starts, options);
            return starts;
        }

        async openBook(book) {
            this.reset();
            this.documentRef = String(book && book.id !== undefined ? book.id : book);
            this.opening = true;
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

                const record = this.resumeStore.read(this.documentRef);
                let restored = false;
                if (record && this.resume.sameCandidate(record, this.openResponse)) {
                    restored = Boolean(await this.restoreResumeLocation(record));
                } else if (record) {
                    this.resumeStore.clear(this.documentRef);
                }

                if (!restored) {
                    const first = await this.requestWindow(0);
                    this.setVisibleWindows(first?.nodes?.length ? [0] : []);
                    this.setStatus('');
                }
                return opened;
            } catch (error) {
                this.renderError(error);
                throw error;
            } finally {
                this.opening = false;
                this.setNavigationDisabled(false);
                this.emitPageChange();
            }
        }

        async loadMore(options = {}) {
            if (!this.documentRef || !this.candidateId) return null;
            const starts = this.visibleStarts();
            const tail = starts.length ? this.windowRecord(starts[starts.length - 1]) : null;
            const target = options.replace === true
                ? 0
                : (tail?.nextNodeOrder == null ? this.nextNodeOrder : tail.nextNodeOrder);
            if (!Number.isInteger(Number(target)) || Number(target) < 0) return null;
            if (!options.silent) this.setStatus('正在加载内容…');
            const record = await this.requestWindow(Number(target));
            if (!record?.nodes?.length) return record;
            const nextStarts = options.replace === true
                ? [record.start]
                : starts.concat(record.start).slice(-MAX_VISIBLE_WINDOWS);
            this.setVisibleWindows(nextStarts, {
                render: !options.deferRender,
                anchorNodeId: options.anchorNodeId || null,
                anchorBlock: options.anchorBlock || 'start',
            });
            if (!options.silent) this.setStatus('');
            this.emitPageChange();
            return record;
        }

        async loadPreviousWindow(options = {}) {
            const starts = this.visibleStarts();
            const firstStart = starts[0] ?? 0;
            if (firstStart <= 0) return null;
            const previous = await this.requestWindow(Math.max(0, firstStart - NODE_LIMIT));
            if (!previous?.nodes?.length) return null;
            const nextStarts = [previous.start, firstStart];
            this.setVisibleWindows(nextStarts, {
                anchorNodeId: options.anchorNodeId || null,
                anchorBlock: options.anchorBlock || 'start',
            });
            this.emitPageChange();
            return previous;
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

        navigationButtons() {
            const nav = this.element('readerV2Navigation');
            return Array.from(nav?.querySelectorAll?.('.reader-v2-nav-item') || []);
        }

        setNavigationDisabled(disabled) {
            for (const button of this.navigationButtons()) button.disabled = Boolean(disabled || this.opening);
        }

        setNavigationBusy(button, busy, scanned = 0) {
            if (!button) return;
            if (!button.dataset.readerNavLabel) button.dataset.readerNavLabel = String(button.textContent || '目标章节');
            const label = button.dataset.readerNavLabel;
            if (busy) {
                this.setNavigationDisabled(true);
                button.setAttribute?.('aria-busy', 'true');
                button.textContent = scanned > 0
                    ? `⏳ ${label} · 已扫描 ${scanned} 个内容块`
                    : `⏳ ${label} · 正在定位…`;
            } else {
                button.removeAttribute?.('aria-busy');
                button.textContent = label;
                this.setNavigationDisabled(false);
            }
        }

        renderNavigation() {
            const nav = this.element('readerV2Navigation');
            if (!nav) return;
            this.clear(nav);
            for (const entry of this.navigation) {
                const button = createElement(this.document, 'button', 'reader-v2-nav-item', entry.label || '未命名标题');
                button.type = 'button';
                button.dataset.readerNavNodeId = String(entry?.location?.node_id || '');
                button.dataset.readerNavLabel = String(entry.label || '未命名标题');
                button.style.setProperty('--reader-level', String(Math.max(0, Number(entry.heading_level || 1) - 1)));
                button.addEventListener('click', () => this.navigateTo(entry.location, { sourceButton: button }).catch((error) => this.renderError(error)));
                nav.appendChild(button);
            }
            if (!this.navigation.length) nav.appendChild(createElement(this.document, 'p', 'reader-v2-empty', '没有标题导航'));
            this.setNavigationDisabled(this.opening);
        }

        locationForNode(nodeId) {
            const node = this.cachedNode(nodeId);
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
            const resolvedOrder = Number.isInteger(extra.nodeOrder)
                ? extra.nodeOrder
                : this.nodeOrder(location.node_id);
            const record = this.resume.recordForLocation(this.openResponse, location, {
                ...extra,
                nodeOrder: resolvedOrder,
            });
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

        async probeNodeOrder(nodeId, options = {}) {
            const expected = String(nodeId || '').trim();
            if (!expected) return null;
            const cached = this.nodeOrder(expected);
            if (cached !== null) return cached;
            let start = 0;
            let scanned = 0;
            while (true) {
                const record = await this.requestWindow(start, { cache: false });
                const found = (record?.nodes || []).find((node) => String(node?.node_id || '') === expected) || null;
                scanned += record?.nodes?.length || 0;
                options.onProgress?.(scanned);
                if (found) {
                    const aligned = windowStartForOrder(found.order);
                    this.contentWindows.set(aligned, Object.freeze({
                        ...record,
                        start: aligned,
                    }));
                    return Number(found.order);
                }
                if (!record?.hasMore) return null;
                const next = Number(record.nextNodeOrder);
                if (!Number.isInteger(next) || next <= start) return null;
                start = next;
            }
        }

        async ensureNodeLoaded(nodeId, options = {}) {
            const expected = String(nodeId || '').trim();
            if (!expected) return null;
            let node = this.model.findNodeById(this.nodes, expected);
            if (node) return node;
            const hintedOrder = Number(options.nodeOrder);
            const order = Number.isInteger(hintedOrder) && hintedOrder >= 0
                ? hintedOrder
                : await this.probeNodeOrder(expected, options);
            if (!Number.isInteger(order) || order < 0) return null;
            await this.loadWindowPair(windowStartForOrder(order));
            return this.model.findNodeById(this.nodes, expected);
        }

        async restoreResumeLocation(record = null) {
            if (!this.documentRef || !this.openResponse) return null;
            const stored = record || this.resumeStore.read(this.documentRef);
            if (!stored) return null;
            if (!this.resume.sameCandidate(stored, this.openResponse)) {
                this.resumeStore.clear(this.documentRef);
                return null;
            }
            let order = Number.isInteger(stored.node_order) && stored.node_order >= 0 ? stored.node_order : null;
            const legacy = order === null;
            if (legacy) {
                this.setStatus('正在升级历史阅读位置…');
                order = await this.probeNodeOrder(stored.node_id, {
                    onProgress: (scanned) => this.setStatus(`正在升级历史阅读位置… 已扫描 ${scanned} 个内容块`),
                });
            }
            if (order === null) return null;
            await this.loadWindowPair(windowStartForOrder(order));
            const node = this.model.findNodeById(this.nodes, stored.node_id);
            if (!node) return null;
            const location = this.locationForNode(node.node_id) || node.location || stored;
            this.resumeRecord = stored;
            this.lastLocation = location;
            this.scrollLoadedNode(node.node_id, { persist: false, behavior: 'auto' });
            if (legacy) {
                this.persistLocation(location, {
                    nodeOrder: Number(node.order),
                    frameId: stored.frame_id,
                    frameOrdinal: stored.frame_ordinal,
                });
            }
            this.setStatus('已恢复上次阅读位置。');
            return this.resumeRecord;
        }

        scrollLoadedNode(nodeId, options = {}) {
            const node = this.model.findNodeById(this.nodes, nodeId);
            if (!node) return false;
            const nodeEl = this.document?.querySelector?.(`[data-reader-node-id="${escapeSelector(nodeId)}"]`);
            if (!nodeEl) return false;
            nodeEl.scrollIntoView?.({ block: options.block || 'center', behavior: options.behavior || 'auto' });
            if (options.focus !== false) nodeEl.focus?.({ preventScroll: true });
            const resolved = this.locationForNode(nodeId) || node.location || { node_id: nodeId };
            this.lastLocation = resolved;
            if (options.persist !== false) this.persistLocation(resolved, { nodeOrder: Number(node.order) });
            this.emitPageChange();
            return true;
        }

        async navigateTo(location, options = {}) {
            const nodeId = String(location?.node_id || '').trim();
            if (!nodeId || this.navigationPending) return false;
            if (this.model.findNodeById(this.nodes, nodeId)) return this.scrollLoadedNode(nodeId, options);

            const sourceButton = options.sourceButton || this.navigationButtons().find((button) => button.dataset.readerNavNodeId === nodeId) || null;
            this.navigationPending = true;
            this.setNavigationBusy(sourceButton, true, 0);
            try {
                const hinted = Number(location?.node_order);
                const order = Number.isInteger(hinted) && hinted >= 0
                    ? hinted
                    : await this.probeNodeOrder(nodeId, {
                        onProgress: (scanned) => this.setNavigationBusy(sourceButton, true, scanned),
                    });
                if (order === null) {
                    this.setStatus('未能定位到该章节。', 'info');
                    return false;
                }
                await this.loadWindowPair(windowStartForOrder(order));
                const found = this.scrollLoadedNode(nodeId, options);
                if (found) this.setStatus('');
                return found;
            } catch (error) {
                this.renderError(error);
                return false;
            } finally {
                this.navigationPending = false;
                this.setNavigationBusy(sourceButton, false);
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
                const results = [];
                let start = 0;
                let truncated = false;
                while (generation === this.findGeneration && results.length < FIND_RESULT_LIMIT) {
                    const record = await this.requestWindow(start, { cache: false });
                    const remaining = FIND_RESULT_LIMIT - results.length;
                    const search = this.finder.findInNodes(this.openResponse, record?.nodes || [], normalized, { maxResults: remaining });
                    results.push(...search.results);
                    if (search.truncated) {
                        truncated = true;
                        break;
                    }
                    if (!record?.hasMore) break;
                    const next = Number(record.nextNodeOrder);
                    if (!Number.isInteger(next) || next <= start) break;
                    start = next;
                }
                if (generation !== this.findGeneration) return [];
                if (results.length >= FIND_RESULT_LIMIT) truncated = true;

                this.findResults = results;
                this.findTruncated = truncated;
                this.findIndex = results.length ? 0 : -1;
                this.updateFindControls();
                const active = this.currentFindResult();
                if (active) await this.navigateTo({ node_id: active.node_id, node_order: active.node_order });
                this.setStatus(results.length ? '' : '没有找到匹配内容。');
                return results;
            } catch (error) {
                if (generation === this.findGeneration) this.renderError(error);
                throw error;
            }
        }

        async navigateFind(delta) {
            if (!this.findResults.length) return false;
            const nextIndex = (this.findIndex + Number(delta) + this.findResults.length) % this.findResults.length;
            this.findIndex = nextIndex;
            const active = this.currentFindResult();
            if (!active) {
                this.clearFind({ clearInput: false });
                return false;
            }
            this.updateFindControls();
            return this.navigateTo({ node_id: active.node_id, node_order: active.node_order });
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

        currentPageIndex() {
            const pages = Array.from(this.element('readerV2Pages')?.querySelectorAll?.('.reader-v2-page') || []);
            if (!pages.length) return -1;
            const main = this.document?.querySelector?.('.reader-v2-main');
            if (!main) return 0;
            const mainRect = main.getBoundingClientRect?.();
            if (mainRect && Number.isFinite(mainRect.top) && Number.isFinite(mainRect.bottom)) {
                const probeY = Number(mainRect.top) + Math.min(Math.max(1, Number(mainRect.height || 1)) * 0.35, 180);
                let nearest = 0;
                let distance = Number.POSITIVE_INFINITY;
                for (let index = 0; index < pages.length; index += 1) {
                    const rect = pages[index]?.getBoundingClientRect?.();
                    if (!rect) continue;
                    if (rect.top <= probeY && rect.bottom > probeY) return index;
                    const nextDistance = Math.min(Math.abs(rect.top - probeY), Math.abs(rect.bottom - probeY));
                    if (nextDistance < distance) {
                        distance = nextDistance;
                        nearest = index;
                    }
                }
                return nearest;
            }
            return 0;
        }

        currentPage() {
            const index = this.currentPageIndex();
            return index >= 0 ? this.presentationState.pages?.[index] || null : null;
        }

        currentPageFirstNode() {
            return this.currentPage()?.nodes?.[0] || null;
        }

        pageNavigationState() {
            const pages = this.presentationState.pages || [];
            const index = pages.length ? Math.max(0, this.currentPageIndex()) : -1;
            const starts = this.visibleStarts();
            const firstStart = starts[0] ?? 0;
            const tail = starts.length ? this.windowRecord(starts[starts.length - 1]) : null;
            return {
                readable: Boolean(this.openResponse && pages.length),
                index,
                pageCount: pages.length,
                atDocumentStart: index <= 0 && firstStart === 0,
                atDocumentEnd: index >= pages.length - 1 && Boolean(tail && !tail.hasMore),
                pending: Boolean(this.navigationPending || this.opening || this.autoLoadPromise),
            };
        }

        scrollToPage(index, options = {}) {
            const sections = Array.from(this.element('readerV2Pages')?.querySelectorAll?.('.reader-v2-page') || []);
            if (!sections.length) return false;
            const bounded = Math.max(0, Math.min(sections.length - 1, Number(index) || 0));
            sections[bounded]?.scrollIntoView?.({ block: 'start', behavior: options.behavior || 'smooth' });
            const node = this.presentationState.pages?.[bounded]?.nodes?.[0];
            if (node?.node_id) {
                const location = this.locationForNode(node.node_id) || node.location || { node_id: node.node_id };
                this.lastLocation = location;
                if (options.persist !== false) this.persistLocation(location, { nodeOrder: Number(node.order) });
            }
            this.emitPageChange();
            return true;
        }

        async firstPage() {
            if (!this.windowRecord(0)) await this.requestWindow(0);
            this.setVisibleWindows([0]);
            return this.scrollToPage(0);
        }

        async lastPage() {
            let starts = this.visibleStarts();
            let tail = starts.length ? this.windowRecord(starts[starts.length - 1]) : null;
            if (!tail) tail = await this.requestWindow(0, { cache: false });
            let previous = null;
            while (tail?.hasMore) {
                const nextStart = Number(tail.nextNodeOrder);
                if (!Number.isInteger(nextStart) || nextStart <= tail.start) break;
                previous = tail;
                tail = await this.requestWindow(nextStart, { cache: false });
                this.setStatus(`正在定位尾页… 已到第 ${tail.start + tail.nodes.length} 个内容块`);
            }
            if (!tail?.nodes?.length) return false;
            this.contentWindows.set(tail.start, tail);
            const visible = [];
            if (previous?.nodes?.length) {
                this.contentWindows.set(previous.start, previous);
                visible.push(previous.start);
            }
            visible.push(tail.start);
            this.setVisibleWindows(visible);
            this.setStatus('');
            return this.scrollToPage((this.presentationState.pages || []).length - 1);
        }

        async previousPage() {
            const current = this.currentPageIndex();
            if (current > 0) return this.scrollToPage(current - 1);
            const anchor = this.currentPageFirstNode()?.node_id || null;
            const previous = await this.loadPreviousWindow({ anchorNodeId: anchor, anchorBlock: 'start' });
            if (!previous) return false;
            const anchorIndex = (this.presentationState.pages || []).findIndex((page) => (
                (page.nodes || []).some((node) => node.node_id === anchor)
            ));
            return this.scrollToPage(Math.max(0, anchorIndex - 1));
        }

        async nextPage() {
            const current = this.currentPageIndex();
            const pages = this.presentationState.pages || [];
            if (current >= 0 && current < pages.length - 1) return this.scrollToPage(current + 1);
            if (!this.hasMore) return false;
            const anchor = this.currentPageFirstNode()?.node_id || null;
            const loaded = await this.loadMore({ silent: true, anchorNodeId: anchor, anchorBlock: 'start' });
            if (!loaded) return false;
            const anchorIndex = (this.presentationState.pages || []).findIndex((page) => (
                (page.nodes || []).some((node) => node.node_id === anchor)
            ));
            return this.scrollToPage(Math.max(0, anchorIndex + 1));
        }

        playbackBatchForCurrentPage() {
            const firstNode = this.currentPageFirstNode();
            const order = Number(firstNode?.order);
            if (!firstNode || !Number.isInteger(order) || order < 0) return null;
            const start = windowStartForOrder(order);
            const record = this.windowRecord(start);
            const nodes = record?.nodes?.length
                ? record.nodes
                : this.nodes.filter((node) => Number(node?.order) >= start && Number(node?.order) < start + NODE_LIMIT);
            return nodes.length ? { start, nodes, firstNodeId: firstNode.node_id } : null;
        }

        emitPageChange() {
            const eventCtor = this.document?.defaultView?.CustomEvent || (typeof CustomEvent !== 'undefined' ? CustomEvent : null);
            if (!eventCtor || !this.document?.dispatchEvent) return;
            this.document.dispatchEvent(new eventCtor('reader-v2-page-change', {
                detail: this.pageNavigationState(),
            }));
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
                more.addEventListener('click', () => {
                    const anchor = this.currentPageFirstNode()?.node_id || null;
                    this.loadMore({ anchorNodeId: anchor }).catch((error) => this.renderError(error));
                });
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
                findPrev.addEventListener('click', () => this.navigateFind(-1).catch(() => {}));
            }
            if (findNext && !findNext.dataset.readerV2FindBound) {
                findNext.dataset.readerV2FindBound = '1';
                findNext.addEventListener('click', () => this.navigateFind(1).catch(() => {}));
            }
            for (const id of ['widthInput', 'widthSlider', 'maxLinesInput', 'maxLinesSlider', 'fontInput', 'fontSlider']) {
                const el = this.element(id);
                if (el && !el.dataset.readerV2Bound) {
                    el.dataset.readerV2Bound = '1';
                    el.addEventListener('input', () => this.reflowAndRender());
                    el.addEventListener('change', () => this.reflowAndRender());
                }
            }
            const main = this.document?.querySelector?.('.reader-v2-main');
            if (main && main.dataset.readerV2AutoWindowBound !== '1') {
                main.dataset.readerV2AutoWindowBound = '1';
                let scheduled = false;
                main.addEventListener('scroll', () => {
                    if (!scheduled) {
                        scheduled = true;
                        const refresh = () => {
                            scheduled = false;
                            this.emitPageChange();
                        };
                        const raf = this.document?.defaultView?.requestAnimationFrame;
                        if (typeof raf === 'function') raf(refresh);
                        else refresh();
                    }
                    if (!this.hasMore || this.navigationPending || this.opening || this.autoLoadPromise) return;
                    const remaining = Number(main.scrollHeight || 0) - Number(main.scrollTop || 0) - Number(main.clientHeight || 0);
                    const threshold = Math.max(AUTO_LOAD_THRESHOLD_PX, Number(main.clientHeight || 0) * 0.75);
                    if (remaining > threshold) return;
                    const scrollTop = Number(main.scrollTop || 0);
                    if (this.autoLoadScrollTop !== null && scrollTop < this.autoLoadScrollTop + AUTO_LOAD_MIN_SCROLL_ADVANCE_PX) return;
                    this.autoLoadScrollTop = scrollTop;
                    const anchor = this.currentPageFirstNode()?.node_id || null;
                    this.autoLoadPromise = Promise.resolve(this.loadMore({
                        silent: true,
                        anchorNodeId: anchor,
                        anchorBlock: 'start',
                    })).catch((error) => this.renderError(error)).finally(() => {
                        this.autoLoadPromise = null;
                        this.emitPageChange();
                    });
                }, { passive: true });
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

    return {
        FIND_RESULT_LIMIT,
        MAX_VISIBLE_WINDOWS,
        NODE_LIMIT,
        ReaderV2Controller,
        getDefaultController,
        openBook,
        safeMessage,
        windowStartForOrder,
    };
});