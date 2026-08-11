(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderSpeedPrefetch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const FALLBACK_MAX_NODE_LIMIT = 500;

    function yieldToBrowser(rootObject) {
        if (typeof rootObject?.requestAnimationFrame === 'function') {
            return new Promise((resolve) => rootObject.requestAnimationFrame(() => resolve()));
        }
        if (typeof rootObject?.setTimeout === 'function') {
            return new Promise((resolve) => rootObject.setTimeout(resolve, 0));
        }
        return Promise.resolve();
    }

    function cacheKey(controller) {
        const reader = controller?.reader;
        return `${String(reader?.documentRef || '')}\u001f${String(reader?.candidateId || reader?.openResponse?.candidate_id || '')}`;
    }

    function cachedPlaybackNodes(controller) {
        const cache = controller?.__readerSpeedPlaybackContent;
        if (!cache || cache.key !== cacheKey(controller) || !Array.isArray(cache.nodes)) return null;
        return cache.nodes;
    }

    function maxNodeLimit(rootObject) {
        const configured = Number(rootObject?.ReaderApiV2?.MAX_NODE_LIMIT || FALLBACK_MAX_NODE_LIMIT);
        return Math.max(1, Math.min(FALLBACK_MAX_NODE_LIMIT, configured || FALLBACK_MAX_NODE_LIMIT));
    }

    async function prefetchPlaybackNodes(controller, rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const reader = controller?.reader;
        if (!reader?.openResponse) return [];

        const cached = cachedPlaybackNodes(controller);
        if (cached) return cached;

        if (!reader.api?.content || !reader.model?.mergeNodes || !reader.documentRef || !reader.candidateId) {
            return Array.isArray(reader.nodes) ? reader.nodes : [];
        }

        const key = cacheKey(controller);
        let nodes = Array.isArray(reader.nodes) ? reader.nodes.slice() : [];
        let hasMore = Boolean(reader.hasMore);
        let nextNodeOrder = Number(reader.nextNodeOrder || nodes.length || 0);
        const limit = maxNodeLimit(rootObject);

        while (hasMore) {
            const chunk = await reader.api.content(reader.documentRef, {
                candidateId: reader.candidateId,
                startNodeOrder: nextNodeOrder,
                limit,
            });
            nodes = reader.model.mergeNodes(nodes, chunk?.nodes || []);
            hasMore = Boolean(chunk?.has_more);
            nextNodeOrder = chunk?.next_node_order == null
                ? nodes.length
                : Number(chunk.next_node_order);
            reader.setStatus?.(`正在准备速度阅读… 已加载 ${nodes.length} 个内容块`);
            await yieldToBrowser(rootObject);
        }

        controller.__readerSpeedPlaybackContent = Object.freeze({
            key,
            nodes,
        });
        return nodes;
    }

    function wrapEnsureAllContent(target, rootObject) {
        if (!target || typeof target.ensureAllContent !== 'function') return false;
        if (Object.prototype.hasOwnProperty.call(target, '__readerSpeedPrefetchEnsureWrapped')) return false;
        const original = target.ensureAllContent;
        target.ensureAllContent = async function ensureAllPlaybackContentWithoutReaderRendering(...args) {
            const reader = this.reader;
            if (!reader?.api?.content || !reader?.model?.mergeNodes) return original.apply(this, args);
            return prefetchPlaybackNodes(this, rootObject);
        };
        Object.defineProperty(target, '__readerSpeedPrefetchEnsureWrapped', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function wrapRefreshFrames(target) {
        if (!target || typeof target.refreshFrames !== 'function') return false;
        if (Object.prototype.hasOwnProperty.call(target, '__readerSpeedPrefetchFramesWrapped')) return false;
        const original = target.refreshFrames;
        target.refreshFrames = function refreshFramesFromPlaybackPrefetch(options = {}) {
            const nodes = cachedPlaybackNodes(this);
            if (!nodes || !this.reader?.openResponse) return original.call(this, options);
            const built = this.adapter.buildPlaybackFrames(
                this.reader.openResponse,
                nodes,
                this.adapterOptions(),
            );
            this.playback.setFrames(built.frames, { preserveIdentity: options.preserveIdentity !== false });
            this.updateControls?.();
            return built.frames;
        };
        Object.defineProperty(target, '__readerSpeedPrefetchFramesWrapped', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function install(rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const Controller = rootObject?.ReaderSpeedPlaybackUI?.ReaderSpeedPlaybackUIController;
        if (!Controller) return false;
        wrapEnsureAllContent(Controller.prototype, rootObject);
        wrapRefreshFrames(Controller.prototype);
        const controller = rootObject?.ReaderSpeedPlaybackUI?.getDefaultController?.();
        if (controller) {
            wrapEnsureAllContent(controller, rootObject);
            wrapRefreshFrames(controller);
        }
        return true;
    }

    return {
        FALLBACK_MAX_NODE_LIMIT,
        cacheKey,
        cachedPlaybackNodes,
        install,
        maxNodeLimit,
        prefetchPlaybackNodes,
        wrapEnsureAllContent,
        wrapRefreshFrames,
        yieldToBrowser,
    };
});
