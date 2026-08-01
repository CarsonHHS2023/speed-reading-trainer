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
            this.setStatus('正在打开 Reader v2 并读取页面列表…');

            const opened = await this.api.open(normalizedRef);
            if (generation !== this._documentLoadGeneration) return [];

            this.openResponse = opened;
            const requestedCandidateId = String(candidateId || '').trim();
            const currentCandidateId = String(opened.candidate_id || '').trim();
            this.candidateId = requestedCandidateId || currentCandidateId;

            if (this.candidateId === currentCandidateId) {
                const navigationResponse = await this.api.navigation(normalizedRef, {
                    candidateId: currentCandidateId,
                });
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

            this.resetPageState();
            this.selectedSourceUnitId = normalizedId;
            const unit = Debug.sourceUnitIndex(this.openResponse).get(normalizedId);
            const label = normalizedId === Debug.ALL_SOURCE_UNITS ? '全文' : Debug.sourceUnitLabel(unit);
            const isCurrent = () => (
                generation === this._pageLoadGeneration
                && this.selectedSourceUnitId === normalizedId
            );
            this.setStatus(`正在加载${label}节点…`);

            let result;
            try {
                result = await Debug.collectNodesForSourceUnit({
                    openResponse: this.openResponse,
                    sourceUnitId: normalizedId,
                    fetchChunk: ({ startNodeOrder, limit }) => this.api.content(this.documentRef, {
                        candidateId: this.candidateId,
                        startNodeOrder,
                        limit,
                    }),
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
                this.openResponse,
                this.visibleNodes,
                { lineWidth: 35, maxLines: 20, fontSize: 28, viewportWidth: 700 },
            );
            this.records = Debug.buildDebugRecords(
                this.rawNodes,
                this.openResponse,
                this.presentationState,
                {
                    Model: this.model,
                    TocIntegration: this.tocIntegration,
                    selectedSourceUnitId: normalizedId === Debug.ALL_SOURCE_UNITS ? null : normalizedId,
                },
            );

            if (!isCurrent()) return [];
            this.populateFilterOptions();
            this.renderSummary();
            this.applyFilters();
            this.setStatus(`${label}已加载 ${this.rawNodes.length} 个原始节点。`);
            this.syncUrl();
            return this.records;
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
        bootstrap,
    };
});
