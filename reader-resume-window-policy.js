(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderResumeWindowPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function chunkRecord(reader, chunk, start) {
        const nodes = reader.model.orderedNodes(chunk?.nodes || []);
        return Object.freeze({
            start,
            nodes,
            hasMore: Boolean(chunk?.has_more),
            nextNodeOrder: chunk?.next_node_order == null ? null : Number(chunk.next_node_order),
        });
    }

    function isMissingResumeNodeError(error) {
        return Number(error?.status) === 404 || String(error?.code || '') === 'reader_node_not_found';
    }

    function clearStaleResume(reader) {
        reader?.resumeStore?.clear?.(reader.documentRef);
        reader.resumeRecord = null;
        return null;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const ReaderUI = rootObject?.ReaderUIV2;
        const Controller = ReaderUI?.ReaderV2Controller;
        if (!Controller || Controller.prototype.__resumeWindowPolicyInstalled) return false;

        Controller.prototype.restoreResumeLocation = async function restoreResumeLocationBounded(record = null) {
            if (!this.documentRef || !this.openResponse) return null;
            const stored = record || this.resumeStore.read(this.documentRef);
            if (!stored) return null;
            if (!this.resume.sameCandidate(stored, this.openResponse)) {
                return clearStaleResume(this);
            }

            const expectedNodeId = String(stored.node_id || '').trim();
            if (!expectedNodeId) return clearStaleResume(this);
            let order = Number.isInteger(stored.node_order) && stored.node_order >= 0
                ? stored.node_order
                : null;
            const legacy = order === null;
            let windowRecord = null;

            if (legacy) {
                this.setStatus('正在恢复历史阅读位置…');
                if (typeof this.api?.contentAround !== 'function') return clearStaleResume(this);
                let chunk;
                try {
                    chunk = await this.api.contentAround(this.documentRef, expectedNodeId, {
                        candidateId: this.candidateId,
                        limit: ReaderUI.NODE_LIMIT,
                    });
                } catch (error) {
                    // A legacy record can outlive the exact Reader node it once
                    // referenced. Treat only a missing-node lookup as stale local
                    // history; transport, selection, and service failures must still
                    // propagate so opening the book does not hide real Reader errors.
                    if (isMissingResumeNodeError(error)) return clearStaleResume(this);
                    throw error;
                }
                const target = (chunk?.nodes || []).find((node) => String(node?.node_id || '') === expectedNodeId) || null;
                if (!target || !Number.isInteger(Number(target.order))) return clearStaleResume(this);
                order = Number(target.order);
                const start = ReaderUI.windowStartForOrder(order);
                windowRecord = chunkRecord(this, chunk, start);
                this.contentWindows.set(start, windowRecord);
            } else {
                const start = ReaderUI.windowStartForOrder(order);
                windowRecord = await this.requestWindow(start);
            }

            if (!windowRecord?.nodes?.length) return clearStaleResume(this);
            this.setVisibleWindows([windowRecord.start]);
            const node = this.model.findNodeById(this.nodes, expectedNodeId);
            if (!node) return clearStaleResume(this);

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
        };

        Controller.prototype.navigateTo = async function navigateToBounded(location, options = {}) {
            const nodeId = String(location?.node_id || '').trim();
            if (!nodeId || this.navigationPending) return false;
            if (this.model.findNodeById(this.nodes, nodeId)) return this.scrollLoadedNode(nodeId, options);

            const sourceButton = options.sourceButton
                || this.navigationButtons().find((button) => button.dataset.readerNavNodeId === nodeId)
                || null;
            this.navigationPending = true;
            this.setNavigationBusy(sourceButton, true, 0);
            try {
                const hinted = Number(location?.node_order);
                let order = Number.isInteger(hinted) && hinted >= 0 ? hinted : null;

                if (order === null && typeof this.api?.contentAround === 'function') {
                    let chunk;
                    try {
                        chunk = await this.api.contentAround(this.documentRef, nodeId, {
                            candidateId: this.candidateId,
                            limit: ReaderUI.NODE_LIMIT,
                        });
                    } catch (error) {
                        if (String(error?.code || '') === 'reader_node_not_found') {
                            this.setStatus('未能定位到该章节。', 'info');
                            return false;
                        }
                        throw error;
                    }
                    const target = (chunk?.nodes || []).find((node) => String(node?.node_id || '') === nodeId) || null;
                    if (!target || !Number.isInteger(Number(target.order))) {
                        this.setStatus('未能定位到该章节。', 'info');
                        return false;
                    }
                    order = Number(target.order);
                    const start = ReaderUI.windowStartForOrder(order);
                    this.contentWindows.set(start, chunkRecord(this, chunk, start));
                } else if (order === null) {
                    order = await this.probeNodeOrder(nodeId, {
                        onProgress: (scanned) => this.setNavigationBusy(sourceButton, true, scanned),
                    });
                }

                if (order === null) {
                    this.setStatus('未能定位到该章节。', 'info');
                    return false;
                }
                await this.loadWindowPair(ReaderUI.windowStartForOrder(order));
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
        };

        Object.defineProperty(Controller.prototype, '__resumeWindowPolicyInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    return { clearStaleResume, install, isMissingResumeNodeError };
});
