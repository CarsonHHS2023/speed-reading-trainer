(function (root, factory) {
    const api = factory(
        root && root.ReaderNodeDebugV2,
        typeof require === 'function' ? require : null,
    );
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderNodeDebugV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DebugApi, requireFunction) {
    'use strict';

    const Debug = DebugApi || (requireFunction ? requireFunction('./reader-node-debug.js') : null);
    if (!Debug || typeof Debug.ReaderNodeDebugController !== 'function') {
        throw new Error('ReaderNodeDebugV2 must be loaded before reader-node-debug-runtime.js');
    }

    const BaseController = Debug.ReaderNodeDebugController;

    function safeJson(value, spacing = 2) {
        const ancestors = new WeakSet();

        function normalize(current) {
            if (typeof current === 'bigint') return String(current);
            if (!current || typeof current !== 'object') return current;
            if (ancestors.has(current)) return '[Circular]';

            ancestors.add(current);
            try {
                if (Array.isArray(current)) return current.map((item) => normalize(item));
                if (typeof current.toJSON === 'function') {
                    const serialized = current.toJSON();
                    if (serialized !== current) return normalize(serialized);
                }
                const output = {};
                for (const [key, item] of Object.entries(current)) {
                    const normalized = normalize(item);
                    if (normalized !== undefined) output[key] = normalized;
                }
                return output;
            } finally {
                ancestors.delete(current);
            }
        }

        return JSON.stringify(normalize(value), null, spacing);
    }

    function serializeDebugBundle(state, spacing = 2) {
        return safeJson(Debug.buildDebugBundle(state), spacing);
    }

    function presentationForNode(presentationState, nodeId, preferredSourceUnitId = null) {
        const expectedNodeId = String(nodeId || '').trim();
        const expectedSourceUnitId = String(preferredSourceUnitId || '').trim();
        if (!expectedNodeId) return null;

        let fallback = null;
        for (const page of presentationState?.pages || []) {
            for (const node of page?.nodes || []) {
                if (String(node?.node_id || '') !== expectedNodeId) continue;
                const entry = {
                    mode: presentationState?.mode || null,
                    presentation_id: page.presentation_id || null,
                    page_kind: page.kind || null,
                    presentation_order: page.presentation_order ?? null,
                    source_unit_id: page.source_unit_id || null,
                    source_order: page.source_order ?? null,
                };
                if (!fallback) fallback = entry;
                if (expectedSourceUnitId && entry.source_unit_id === expectedSourceUnitId) {
                    return entry;
                }
            }
        }
        return fallback;
    }

    function visibleTocIntegration(integration, visibleNodes) {
        if (!integration || typeof integration.tocLayout !== 'function') return integration;
        const visibleNodeIds = new Set(
            (visibleNodes || [])
                .map((node) => String(node?.node_id || '').trim())
                .filter(Boolean),
        );
        return {
            tocLayout(page) {
                return integration.tocLayout({
                    ...page,
                    nodes: (page?.nodes || []).filter((node) => (
                        visibleNodeIds.has(String(node?.node_id || '').trim())
                    )),
                });
            },
        };
    }

    class ReaderNodeDebugRuntimeController extends BaseController {
        reset() {
            this._documentLoadGeneration = Number(this._documentLoadGeneration || 0) + 1;
            this._pageLoadGeneration = Number(this._pageLoadGeneration || 0) + 1;
            return super.reset();
        }

        async openDocument(documentRef, candidateId = null) {
            const normalizedRef = String(documentRef || '').trim();
            if (!normalizedRef) throw new Error('请选择书籍或输入 document_ref');

            this.reset();
            const generation = this._documentLoadGeneration;
            this.documentRef = normalizedRef;
            this.populatePageOptions();
            this.clearPageDisplay();
            this.syncUrl();
            this.setStatus('正在打开 Reader v2 并读取页面列表…');

            let opened;
            try {
                opened = await this.api.open(normalizedRef);
            } catch (error) {
                if (generation !== this._documentLoadGeneration) return [];
                throw error;
            }
            if (generation !== this._documentLoadGeneration) return [];

            this.openResponse = opened;
            const requestedCandidateId = String(candidateId || '').trim();
            const currentCandidateId = String(opened.candidate_id || '').trim();
            this.candidateId = requestedCandidateId || currentCandidateId;

            if (this.candidateId === currentCandidateId) {
                let navigationResponse;
                try {
                    navigationResponse = await this.api.navigation(normalizedRef, {
                        candidateId: currentCandidateId,
                    });
                } catch (error) {
                    if (generation !== this._documentLoadGeneration) return [];
                    throw error;
                }
                if (generation !== this._documentLoadGeneration) return [];
                this.navigation = navigationResponse.navigation || [];
            } else {
                // Reader navigation is selected-candidate only. Do not validate the
                // current navigation response as if it belonged to a historical candidate.
                this.navigation = [];
            }

            const pages = this.populatePageOptions();
            this.clearPageDisplay();
            if (generation !== this._documentLoadGeneration) return [];
            this.setStatus(pages.length ? '请选择页面加载节点。' : '当前文档没有可选页面。');
            this.syncUrl();
            return pages;
        }

        async loadSelectedPage(sourceUnitId) {
            const normalizedId = String(sourceUnitId || '').trim();
            const generation = Number(this._pageLoadGeneration || 0) + 1;
            this._pageLoadGeneration = generation;

            if (!this.openResponse || !this.documentRef || !this.candidateId) {
                throw new Error('请先选择书籍或打开文档');
            }
            if (!normalizedId) {
                this.resetPageState();
                this.clearPageDisplay();
                this.syncUrl();
                this.setStatus('请选择页面加载节点。');
                return [];
            }

            const documentGeneration = this._documentLoadGeneration;
            const openResponse = this.openResponse;
            const documentRef = this.documentRef;
            const candidateId = this.candidateId;

            this.resetPageState();
            this.clearPageDisplay();
            this.selectedSourceUnitId = normalizedId;
            this.syncUrl();
            const unit = Debug.sourceUnitIndex(openResponse).get(normalizedId);
            const label = normalizedId === Debug.ALL_SOURCE_UNITS ? '全文' : Debug.sourceUnitLabel(unit);
            const isCurrent = () => (
                generation === this._pageLoadGeneration
                && documentGeneration === this._documentLoadGeneration
                && this.selectedSourceUnitId === normalizedId
                && this.documentRef === documentRef
                && this.candidateId === candidateId
            );
            this.setStatus(`正在加载${label}节点…`);

            let result;
            try {
                result = await Debug.collectNodesForSourceUnit({
                    openResponse,
                    sourceUnitId: normalizedId,
                    fetchChunk: ({ startNodeOrder, limit }) => {
                        if (!isCurrent()) throw new Error('stale_reader_node_debug_page_load');
                        return this.api.content(documentRef, {
                            candidateId,
                            startNodeOrder,
                            limit,
                        });
                    },
                    onProgress: ({ scannedNodeCount, selectedNodeCount }) => {
                        if (!isCurrent()) return;
                        this.setStatus(
                            `正在加载${label}节点：已扫描 ${scannedNodeCount}，找到 ${selectedNodeCount}…`,
                        );
                    },
                });
            } catch (error) {
                if (!isCurrent()) return [];
                throw error;
            }

            if (!isCurrent()) return [];
            this.rawChunks = result.rawChunks;
            this.rawNodes = result.pageNodes;
            this.scanStats = result.scanStats;
            this.visibleNodes = this.model.orderedNodes(this.rawNodes);
            this.presentationState = this.presentation.presentationForDocument(
                openResponse,
                this.visibleNodes,
                { lineWidth: 35, maxLines: 20, fontSize: 28, viewportWidth: 700 },
            );
            const selectedPresentationSourceUnitId = normalizedId === Debug.ALL_SOURCE_UNITS
                ? null
                : normalizedId;
            this.records = Debug.buildDebugRecords(
                this.rawNodes,
                openResponse,
                this.presentationState,
                {
                    Model: this.model,
                    TocIntegration: visibleTocIntegration(this.tocIntegration, this.visibleNodes),
                    selectedSourceUnitId: selectedPresentationSourceUnitId,
                },
            ).map((record) => ({
                ...record,
                presentation: presentationForNode(
                    this.presentationState,
                    record.node_id,
                    selectedPresentationSourceUnitId,
                ),
            }));

            if (!isCurrent()) return [];
            this.populateFilterOptions();
            this.renderSummary();
            this.applyFilters();
            this.setStatus(`${label}已加载 ${this.rawNodes.length} 个原始节点。`);
            this.syncUrl();
            return this.records;
        }

        exportBundle() {
            if (!this.selectedSourceUnitId) {
                this.setStatus('请先选择页面加载节点。', 'error');
                return;
            }
            const payload = serializeDebugBundle(this, 2);
            const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = this.document.createElement('a');
            link.href = url;
            const unit = Debug.sourceUnitIndex(this.openResponse).get(this.selectedSourceUnitId);
            const pageSuffix = unit?.kind === 'physical_page'
                ? `-page-${Number(unit.source_order) + 1}`
                : `-${this.selectedSourceUnitId}`;
            link.download = `reader-node-debug-${this.documentRef || 'document'}${pageSuffix}.json`;
            link.click();
            URL.revokeObjectURL(url);
        }

        async copySelectedNode() {
            if (!this.selectedRecord) return;
            await navigator.clipboard.writeText(safeJson(this.selectedRecord.raw_node));
            this.setStatus('当前节点 JSON 已复制。');
        }
    }

    function bootstrap() {
        if (typeof document === 'undefined') return null;
        const controller = new ReaderNodeDebugRuntimeController();
        controller.initializeFromLocation()
            .catch((error) => controller.setStatus(error.message, 'error'));
        return controller;
    }

    return {
        ...Debug,
        ReaderNodeDebugController: ReaderNodeDebugRuntimeController,
        presentationForNode,
        visibleTocIntegration,
        safeJson,
        serializeDebugBundle,
        bootstrap,
    };
});
