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

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const ReaderUI = rootObject?.ReaderUIV2;
        const Controller = ReaderUI?.ReaderV2Controller;
        if (!Controller || Controller.prototype.__resumeWindowPolicyInstalled) return false;

        Controller.prototype.restoreResumeLocation = async function restoreResumeLocationBounded(record = null) {
            if (!this.documentRef || !this.openResponse) return null;
            const stored = record || this.resumeStore.read(this.documentRef);
            if (!stored) return null;
            if (!this.resume.sameCandidate(stored, this.openResponse)) {
                this.resumeStore.clear(this.documentRef);
                return null;
            }

            const expectedNodeId = String(stored.node_id || '').trim();
            if (!expectedNodeId) return null;
            let order = Number.isInteger(stored.node_order) && stored.node_order >= 0
                ? stored.node_order
                : null;
            const legacy = order === null;
            let windowRecord = null;

            if (legacy) {
                this.setStatus('正在恢复历史阅读位置…');
                if (typeof this.api?.contentAround !== 'function') return null;
                const chunk = await this.api.contentAround(this.documentRef, expectedNodeId, {
                    candidateId: this.candidateId,
                    limit: ReaderUI.NODE_LIMIT,
                });
                const target = (chunk?.nodes || []).find((node) => String(node?.node_id || '') === expectedNodeId) || null;
                if (!target || !Number.isInteger(Number(target.order))) return null;
                order = Number(target.order);
                const start = ReaderUI.windowStartForOrder(order);
                windowRecord = chunkRecord(this, chunk, start);
                this.contentWindows.set(start, windowRecord);
            } else {
                const start = ReaderUI.windowStartForOrder(order);
                windowRecord = await this.requestWindow(start);
            }

            if (!windowRecord?.nodes?.length) return null;
            this.setVisibleWindows([windowRecord.start]);
            const node = this.model.findNodeById(this.nodes, expectedNodeId);
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
        };

        Object.defineProperty(Controller.prototype, '__resumeWindowPolicyInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    return { install };
});
