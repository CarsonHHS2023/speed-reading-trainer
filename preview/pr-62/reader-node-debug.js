(function (root, factory) {
    const api = factory(
        root && root.ReaderApiV2,
        root && root.ReaderModelV2,
        root && root.ReaderPresentationV2,
    );
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderNodeDebugV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ReaderApi, Model, Presentation) {
    'use strict';

    const CONTENT_BATCH_SIZE = 500;
    const TABLE_PAGE_SIZE = 200;

    function resolveDeps() {
        if (typeof require === 'function') {
            ReaderApi = ReaderApi || require('./reader-api.js');
            Model = Model || require('./reader-model.js');
            Presentation = Presentation || require('./reader-presentation.js');
        }
        return { ReaderApi, Model, Presentation };
    }

    function plainObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function isSuppressedNode(node) {
        const metadata = plainObject(node && node.metadata);
        return metadata.suppressed_as_artifact === true
            || (typeof metadata.suppressed_original_kind === 'string'
                && metadata.suppressed_original_kind.trim() !== '');
    }

    function suppressionReason(node) {
        const metadata = plainObject(node && node.metadata);
        if (metadata.suppressed_as_artifact === true) return 'metadata.suppressed_as_artifact';
        if (typeof metadata.suppressed_original_kind === 'string' && metadata.suppressed_original_kind.trim()) {
            return `metadata.suppressed_original_kind:${metadata.suppressed_original_kind.trim()}`;
        }
        return null;
    }

    function normalizedBBox(node) {
        const candidates = [];
        const locationAnchor = node && node.location && node.location.source_anchor;
        if (locationAnchor) candidates.push(locationAnchor);
        for (const anchor of (node && node.source_anchors) || []) candidates.push(anchor);
        for (const anchor of candidates) {
            const bbox = anchor && anchor.normalized_bbox;
            if (!Array.isArray(bbox) || bbox.length !== 4) continue;
            const values = bbox.map(Number);
            if (values.every(Number.isFinite) && values[2] > values[0] && values[3] > values[1]) {
                return values.map((value) => Math.max(0, Math.min(1, value)));
            }
        }
        return null;
    }

    function primarySourceUnitId(node) {
        return node?.location?.source_unit_id || node?.source_unit_ids?.[0] || null;
    }

    function sourceUnitIndex(openResponse) {
        const index = new Map();
        for (const unit of openResponse?.source_units || []) index.set(unit.source_unit_id, unit);
        return index;
    }

    function pageInfoForNode(node, unitIndex) {
        const sourceUnitId = primarySourceUnitId(node);
        const unit = sourceUnitId ? unitIndex.get(sourceUnitId) : null;
        const isPhysical = unit?.kind === 'physical_page';
        const order = Number(unit?.source_order);
        return {
            source_unit_id: sourceUnitId,
            source_unit_kind: unit?.kind || null,
            source_order: Number.isFinite(order) ? order : null,
            physical_page_number: isPhysical && Number.isFinite(order) ? order + 1 : null,
            dimensions: unit?.dimensions || null,
            rotation_degrees: unit?.rotation_degrees ?? null,
        };
    }

    function warningCodes(node) {
        return [...new Set((node?.warnings || []).map((warning) => warning?.code).filter(Boolean))];
    }

    function buildPresentationIndex(presentationState) {
        const index = new Map();
        for (const page of presentationState?.pages || []) {
            for (const node of page?.nodes || []) {
                if (!node?.node_id || index.has(node.node_id)) continue;
                index.set(node.node_id, {
                    mode: presentationState?.mode || null,
                    presentation_id: page.presentation_id || null,
                    page_kind: page.kind || null,
                    presentation_order: page.presentation_order ?? null,
                    source_unit_id: page.source_unit_id || null,
                    source_order: page.source_order ?? null,
                });
            }
        }
        return index;
    }

    function buildDebugRecords(rawNodes, openResponse, presentationState, deps = {}) {
        const model = deps.Model || Model || {};
        const unitIndex = sourceUnitIndex(openResponse);
        const presentationIndex = buildPresentationIndex(presentationState);
        return (rawNodes || []).map((node, apiIndex) => {
            const metadata = plainObject(node?.metadata);
            const suppressed = isSuppressedNode(node);
            const page = pageInfoForNode(node, unitIndex);
            const frontendTag = typeof model.nodeTag === 'function' ? model.nodeTag(node) : null;
            return {
                api_index: apiIndex,
                node_id: node?.node_id || null,
                order: Number.isFinite(Number(node?.order)) ? Number(node.order) : null,
                node_type: node?.node_type || 'unknown',
                heading_level: node?.heading_level ?? null,
                text: typeof node?.text === 'string' ? node.text : null,
                parent_ref: node?.parent_ref || null,
                child_count: Array.isArray(node?.child_refs) ? node.child_refs.length : 0,
                asset_count: Array.isArray(node?.asset_refs) ? node.asset_refs.length : 0,
                content_state: node?.content_state || null,
                warning_codes: warningCodes(node),
                suppressed,
                suppression_reason: suppressionReason(node),
                frontend_visible: !suppressed,
                frontend_tag: frontendTag,
                normalized_bbox: normalizedBBox(node),
                recovery_rule: metadata.recovery_rule ?? null,
                toc_level: metadata.toc_level ?? null,
                refinement_operation: metadata.refinement_operation ?? metadata.llm_operation ?? null,
                page,
                presentation: presentationIndex.get(node?.node_id) || null,
                raw_node: node,
            };
        });
    }

    function summarizeRecords(records) {
        const summary = {
            raw_node_count: records.length,
            frontend_visible_count: 0,
            suppressed_count: 0,
            warning_node_count: 0,
            types: {},
            heading_levels: {},
        };
        for (const record of records) {
            if (record.frontend_visible) summary.frontend_visible_count += 1;
            if (record.suppressed) summary.suppressed_count += 1;
            if (record.warning_codes.length) summary.warning_node_count += 1;
            summary.types[record.node_type] = (summary.types[record.node_type] || 0) + 1;
            if (record.heading_level !== null && record.heading_level !== undefined) {
                const key = String(record.heading_level);
                summary.heading_levels[key] = (summary.heading_levels[key] || 0) + 1;
            }
        }
        return summary;
    }

    function normalizeFilterText(value) {
        return String(value || '').trim().toLocaleLowerCase();
    }

    function recordMatches(record, filters = {}) {
        const query = normalizeFilterText(filters.query);
        if (query) {
            const haystack = [
                record.node_id,
                record.node_type,
                record.text,
                record.parent_ref,
                record.recovery_rule,
                record.warning_codes.join(' '),
                record.page.source_unit_id,
            ].map((value) => String(value || '').toLocaleLowerCase()).join('\n');
            if (!haystack.includes(query)) return false;
        }
        if (filters.nodeType && filters.nodeType !== 'all' && record.node_type !== filters.nodeType) return false;
        if (filters.headingLevel && filters.headingLevel !== 'all'
            && String(record.heading_level ?? '') !== String(filters.headingLevel)) return false;
        if (filters.pageNumber) {
            const requested = Number(filters.pageNumber);
            if (!Number.isFinite(requested) || record.page.physical_page_number !== requested) return false;
        }
        if (filters.suppression === 'suppressed' && !record.suppressed) return false;
        if (filters.suppression === 'visible' && record.suppressed) return false;
        if (filters.warningsOnly && !record.warning_codes.length) return false;
        if (filters.recoveryRule && normalizeFilterText(record.recovery_rule) !== normalizeFilterText(filters.recoveryRule)) return false;
        return true;
    }

    function filterRecords(records, filters = {}) {
        return (records || []).filter((record) => recordMatches(record, filters));
    }

    function safeJson(value, spacing = 2) {
        const seen = new WeakSet();
        return JSON.stringify(value, (key, current) => {
            if (typeof current === 'bigint') return String(current);
            if (current && typeof current === 'object') {
                if (seen.has(current)) return '[Circular]';
                seen.add(current);
            }
            return current;
        }, spacing);
    }

    function buildDebugBundle(state) {
        return {
            diagnostic_version: 'reader_node_debug_v1',
            generated_at: new Date().toISOString(),
            document_ref: state.documentRef || null,
            candidate_id: state.candidateId || null,
            open_response: state.openResponse || null,
            navigation: state.navigation || [],
            raw_content_chunks: state.rawChunks || [],
            raw_nodes: state.rawNodes || [],
            visible_nodes: state.visibleNodes || [],
            presentation_state: state.presentationState || null,
            summary: summarizeRecords(state.records || []),
        };
    }

    function normalizeBook(rawBook) {
        return {
            id: rawBook?.book_id || rawBook?.id || null,
            name: rawBook?.book_title || rawBook?.title || rawBook?.name || '未命名书籍',
            status: rawBook?.status || null,
            fileType: rawBook?.file_type || rawBook?.fileType || null,
        };
    }

    function createElement(documentObject, tag, className, text) {
        const element = documentObject.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined && text !== null) element.textContent = text;
        return element;
    }

    class ReaderNodeDebugController {
        constructor(options = {}) {
            const deps = resolveDeps();
            this.document = options.documentObject || (typeof document !== 'undefined' ? document : null);
            this.api = options.api || new deps.ReaderApi.ReaderApiClientV2(options.apiOptions || {});
            this.model = options.model || deps.Model;
            this.presentation = options.presentation || deps.Presentation;
            this.fetchImpl = options.fetchImpl || this.api.fetchImpl;
            this.reset();
        }

        reset() {
            this.documentRef = null;
            this.candidateId = null;
            this.openResponse = null;
            this.navigation = [];
            this.rawChunks = [];
            this.rawNodes = [];
            this.visibleNodes = [];
            this.presentationState = null;
            this.records = [];
            this.filteredRecords = [];
            this.selectedRecord = null;
            this.tablePage = 0;
        }

        element(id) {
            return this.document?.getElementById(id) || null;
        }

        setStatus(message, kind = 'info') {
            const element = this.element('debugStatus');
            if (!element) return;
            element.textContent = message || '';
            element.dataset.kind = kind;
        }

        async loadBooks() {
            const select = this.element('debugBookSelect');
            if (!select || !this.fetchImpl) return [];
            this.setStatus('正在加载书架…');
            const response = await this.fetchImpl(`${this.api.baseUrl}/api/v1/books`, { headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error(`书架请求失败 (${response.status})`);
            const payload = await response.json();
            const books = (Array.isArray(payload?.books) ? payload.books : [])
                .map(normalizeBook)
                .filter((book) => book.id && book.status !== 'processing')
                .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
            select.textContent = '';
            select.appendChild(createElement(this.document, 'option', '', '选择书籍…'));
            select.options[0].value = '';
            for (const book of books) {
                const option = createElement(this.document, 'option', '', `${book.name}${book.status ? ` · ${book.status}` : ''}`);
                option.value = String(book.id);
                select.appendChild(option);
            }
            this.setStatus('');
            return books;
        }

        async loadDocument(documentRef, candidateId = null) {
            const normalizedRef = String(documentRef || '').trim();
            if (!normalizedRef) throw new Error('请选择书籍或输入 document_ref');
            this.reset();
            this.documentRef = normalizedRef;
            this.setStatus('正在打开 Reader v2…');
            const opened = await this.api.open(normalizedRef);
            this.openResponse = opened;
            this.candidateId = String(candidateId || opened.candidate_id);
            const navigationResponse = await this.api.navigation(normalizedRef, { candidateId: this.candidateId });
            this.navigation = navigationResponse.navigation || [];

            let startNodeOrder = 0;
            let hasMore = true;
            while (hasMore) {
                this.setStatus(`正在读取节点，已加载 ${this.rawNodes.length} 个…`);
                const chunk = await this.api.content(normalizedRef, {
                    candidateId: this.candidateId,
                    startNodeOrder,
                    limit: CONTENT_BATCH_SIZE,
                });
                this.rawChunks.push(chunk);
                this.rawNodes.push(...(chunk.nodes || []));
                hasMore = Boolean(chunk.has_more);
                const next = chunk.next_node_order;
                if (!hasMore) break;
                if (next === null || next === undefined || Number(next) <= startNodeOrder) {
                    throw new Error('Reader content pagination did not advance');
                }
                startNodeOrder = Number(next);
            }

            this.visibleNodes = this.model.orderedNodes(this.rawNodes);
            this.presentationState = this.presentation.presentationForDocument(
                this.openResponse,
                this.visibleNodes,
                { lineWidth: 35, maxLines: 20, fontSize: 28, viewportWidth: 700 },
            );
            this.records = buildDebugRecords(
                this.rawNodes,
                this.openResponse,
                this.presentationState,
                { Model: this.model },
            );
            this.populateFilterOptions();
            this.renderSummary();
            this.applyFilters();
            this.setStatus(`已读取 ${this.rawNodes.length} 个原始节点。`);
            this.syncUrl();
            return this.records;
        }

        populateFilterOptions() {
            const typeSelect = this.element('debugNodeType');
            if (typeSelect) {
                const current = typeSelect.value || 'all';
                typeSelect.textContent = '';
                const all = createElement(this.document, 'option', '', '全部类型');
                all.value = 'all';
                typeSelect.appendChild(all);
                const types = [...new Set(this.records.map((record) => record.node_type))].sort();
                for (const type of types) {
                    const option = createElement(this.document, 'option', '', type);
                    option.value = type;
                    typeSelect.appendChild(option);
                }
                typeSelect.value = types.includes(current) ? current : 'all';
            }
            const ruleSelect = this.element('debugRecoveryRule');
            if (ruleSelect) {
                const current = ruleSelect.value || '';
                ruleSelect.textContent = '';
                const all = createElement(this.document, 'option', '', '全部 recovery_rule');
                all.value = '';
                ruleSelect.appendChild(all);
                const rules = [...new Set(this.records.map((record) => record.recovery_rule).filter(Boolean))].sort();
                for (const rule of rules) {
                    const option = createElement(this.document, 'option', '', rule);
                    option.value = rule;
                    ruleSelect.appendChild(option);
                }
                ruleSelect.value = rules.includes(current) ? current : '';
            }
        }

        currentFilters() {
            return {
                query: this.element('debugSearch')?.value || '',
                nodeType: this.element('debugNodeType')?.value || 'all',
                headingLevel: this.element('debugHeadingLevel')?.value || 'all',
                pageNumber: this.element('debugPageNumber')?.value || '',
                suppression: this.element('debugSuppression')?.value || 'all',
                warningsOnly: Boolean(this.element('debugWarningsOnly')?.checked),
                recoveryRule: this.element('debugRecoveryRule')?.value || '',
            };
        }

        applyFilters() {
            this.filteredRecords = filterRecords(this.records, this.currentFilters());
            this.tablePage = 0;
            this.renderTable();
            this.renderFilterCount();
        }

        renderSummary() {
            const container = this.element('debugSummary');
            if (!container) return;
            container.textContent = '';
            const summary = summarizeRecords(this.records);
            const entries = [
                ['API 原始节点', summary.raw_node_count],
                ['前端可见', summary.frontend_visible_count],
                ['被抑制', summary.suppressed_count],
                ['Heading', summary.types.heading || 0],
                ['List', summary.types.list || 0],
                ['List Item', summary.types.list_item || 0],
                ['Paragraph', summary.types.paragraph || 0],
                ['有 warning', summary.warning_node_count],
            ];
            for (const [label, value] of entries) {
                const card = createElement(this.document, 'div', 'debug-stat');
                card.appendChild(createElement(this.document, 'strong', '', String(value)));
                card.appendChild(createElement(this.document, 'span', '', label));
                container.appendChild(card);
            }
        }

        renderFilterCount() {
            const element = this.element('debugFilterCount');
            if (element) element.textContent = `筛选结果 ${this.filteredRecords.length} / ${this.records.length}`;
        }

        renderTable() {
            const body = this.element('debugNodeRows');
            if (!body) return;
            body.textContent = '';
            const start = this.tablePage * TABLE_PAGE_SIZE;
            const pageRecords = this.filteredRecords.slice(start, start + TABLE_PAGE_SIZE);
            for (const record of pageRecords) {
                const row = createElement(this.document, 'tr', record.suppressed ? 'is-suppressed' : '');
                row.dataset.nodeId = record.node_id || '';
                const values = [
                    record.order ?? '—',
                    record.page.physical_page_number ?? record.page.source_order ?? '—',
                    record.node_type,
                    record.heading_level ?? '—',
                    String(record.text || '').replace(/\s+/g, ' ').slice(0, 120),
                    record.suppressed ? '是' : '否',
                    record.warning_codes.join(', ') || '—',
                    record.recovery_rule || '—',
                    record.node_id || '—',
                ];
                for (const value of values) row.appendChild(createElement(this.document, 'td', '', String(value)));
                row.addEventListener('click', () => this.selectRecord(record));
                body.appendChild(row);
            }
            const pageCount = Math.max(1, Math.ceil(this.filteredRecords.length / TABLE_PAGE_SIZE));
            const label = this.element('debugTablePage');
            if (label) label.textContent = `${Math.min(this.tablePage + 1, pageCount)} / ${pageCount}`;
            const prev = this.element('debugTablePrev');
            const next = this.element('debugTableNext');
            if (prev) prev.disabled = this.tablePage <= 0;
            if (next) next.disabled = this.tablePage >= pageCount - 1;
        }

        selectRecord(record) {
            this.selectedRecord = record;
            for (const row of this.document.querySelectorAll('#debugNodeRows tr')) {
                row.classList.toggle('is-selected', row.dataset.nodeId === record.node_id);
            }
            const raw = this.element('debugRawNode');
            const frontend = this.element('debugFrontendNode');
            const presentation = this.element('debugPresentationNode');
            if (raw) raw.textContent = safeJson(record.raw_node);
            if (frontend) frontend.textContent = safeJson({
                frontend_visible: record.frontend_visible,
                suppression_reason: record.suppression_reason,
                frontend_tag: record.frontend_tag,
                normalized_bbox: record.normalized_bbox,
                page: record.page,
                warning_codes: record.warning_codes,
                recovery_rule: record.recovery_rule,
                toc_level: record.toc_level,
                refinement_operation: record.refinement_operation,
            });
            if (presentation) presentation.textContent = safeJson(record.presentation);
            this.renderBboxPreview(record);
        }

        renderBboxPreview(record) {
            const canvas = this.element('debugBboxCanvas');
            if (!canvas) return;
            canvas.textContent = '';
            const sourceUnitId = record.page.source_unit_id;
            const peers = this.records.filter((item) => item.page.source_unit_id === sourceUnitId && item.normalized_bbox);
            for (const peer of peers) {
                const [x1, y1, x2, y2] = peer.normalized_bbox;
                const box = createElement(this.document, 'button', 'debug-bbox');
                if (peer.node_id === record.node_id) box.classList.add('is-selected');
                if (peer.suppressed) box.classList.add('is-suppressed');
                box.type = 'button';
                box.title = `${peer.node_type} · ${peer.node_id}\n${String(peer.text || '').slice(0, 100)}`;
                box.style.left = `${x1 * 100}%`;
                box.style.top = `${y1 * 100}%`;
                box.style.width = `${(x2 - x1) * 100}%`;
                box.style.height = `${(y2 - y1) * 100}%`;
                box.addEventListener('click', () => this.selectRecord(peer));
                canvas.appendChild(box);
            }
        }

        syncUrl() {
            if (typeof history === 'undefined') return;
            const params = new URLSearchParams(location.search);
            params.set('document_ref', this.documentRef);
            params.set('candidate_id', this.candidateId);
            history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
        }

        exportBundle() {
            const payload = safeJson(buildDebugBundle(this), 2);
            const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = this.document.createElement('a');
            link.href = url;
            link.download = `reader-node-debug-${this.documentRef || 'document'}.json`;
            link.click();
            URL.revokeObjectURL(url);
        }

        async copySelectedNode() {
            if (!this.selectedRecord) return;
            await navigator.clipboard.writeText(safeJson(this.selectedRecord.raw_node));
            this.setStatus('当前节点 JSON 已复制。');
        }

        bind() {
            const load = this.element('debugLoad');
            const select = this.element('debugBookSelect');
            const documentInput = this.element('debugDocumentRef');
            const candidateInput = this.element('debugCandidateId');
            load?.addEventListener('click', () => {
                const documentRef = documentInput?.value || select?.value || '';
                this.loadDocument(documentRef, candidateInput?.value || null).catch((error) => this.setStatus(error.message, 'error'));
            });
            select?.addEventListener('change', () => {
                if (documentInput) documentInput.value = select.value;
            });
            for (const id of ['debugSearch', 'debugNodeType', 'debugHeadingLevel', 'debugPageNumber', 'debugSuppression', 'debugWarningsOnly', 'debugRecoveryRule']) {
                const element = this.element(id);
                element?.addEventListener(element.tagName === 'INPUT' ? 'input' : 'change', () => this.applyFilters());
            }
            this.element('debugTablePrev')?.addEventListener('click', () => {
                this.tablePage = Math.max(0, this.tablePage - 1);
                this.renderTable();
            });
            this.element('debugTableNext')?.addEventListener('click', () => {
                const pageCount = Math.max(1, Math.ceil(this.filteredRecords.length / TABLE_PAGE_SIZE));
                this.tablePage = Math.min(pageCount - 1, this.tablePage + 1);
                this.renderTable();
            });
            this.element('debugExport')?.addEventListener('click', () => this.exportBundle());
            this.element('debugCopyNode')?.addEventListener('click', () => this.copySelectedNode().catch((error) => this.setStatus(error.message, 'error')));
        }

        async initializeFromLocation() {
            this.bind();
            try {
                await this.loadBooks();
            } catch (error) {
                this.setStatus(`书架加载失败：${error.message}`, 'error');
            }
            const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
            const documentRef = params.get('document_ref') || '';
            const candidateId = params.get('candidate_id') || '';
            if (this.element('debugDocumentRef')) this.element('debugDocumentRef').value = documentRef;
            if (this.element('debugCandidateId')) this.element('debugCandidateId').value = candidateId;
            if (documentRef) {
                await this.loadDocument(documentRef, candidateId || null);
            }
        }
    }

    function bootstrap() {
        if (typeof document === 'undefined') return null;
        const controller = new ReaderNodeDebugController();
        controller.initializeFromLocation().catch((error) => controller.setStatus(error.message, 'error'));
        return controller;
    }

    return {
        CONTENT_BATCH_SIZE,
        TABLE_PAGE_SIZE,
        ReaderNodeDebugController,
        buildDebugBundle,
        buildDebugRecords,
        buildPresentationIndex,
        filterRecords,
        isSuppressedNode,
        normalizedBBox,
        pageInfoForNode,
        recordMatches,
        safeJson,
        summarizeRecords,
        bootstrap,
    };
});
