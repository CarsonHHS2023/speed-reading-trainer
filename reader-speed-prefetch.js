(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderSpeedPrefetch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const FALLBACK_MAX_NODE_LIMIT = 500;
    const START_SEED_NODE_LIMIT = 180;
    const START_SEED_LOOKBEHIND = 24;

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

    function playbackContentCache(controller) {
        const cache = controller?.__readerSpeedPlaybackContent;
        if (!cache || cache.key !== cacheKey(controller) || !Array.isArray(cache.nodes)) return null;
        return cache;
    }

    function cachedPlaybackNodes(controller) {
        const cache = playbackContentCache(controller);
        return cache?.complete === true ? cache.nodes : null;
    }

    function maxNodeLimit(rootObject) {
        const configured = Number(rootObject?.ReaderApiV2?.MAX_NODE_LIMIT || FALLBACK_MAX_NODE_LIMIT);
        return Math.max(1, Math.min(FALLBACK_MAX_NODE_LIMIT, configured || FALLBACK_MAX_NODE_LIMIT));
    }

    function currentSemanticNodeId(controller) {
        const frame = controller?.playback?.currentFrame?.();
        return String(
            frame?.identity?.node_id
            || controller?.reader?.lastLocation?.node_id
            || controller?.reader?.resumeRecord?.node_id
            || '',
        ).trim();
    }

    function seedPlaybackNodes(controller, limit = START_SEED_NODE_LIMIT) {
        const nodes = Array.isArray(controller?.reader?.nodes) ? controller.reader.nodes : [];
        const boundedLimit = Math.max(1, Number(limit) || START_SEED_NODE_LIMIT);
        if (nodes.length <= boundedLimit) return nodes.slice();

        const nodeId = currentSemanticNodeId(controller);
        let currentIndex = nodeId
            ? nodes.findIndex((node) => String(node?.node_id || '') === nodeId)
            : -1;
        if (currentIndex < 0) currentIndex = 0;

        let start = Math.max(0, currentIndex - START_SEED_LOOKBEHIND);
        if (start + boundedLimit > nodes.length) start = Math.max(0, nodes.length - boundedLimit);
        return nodes.slice(start, start + boundedLimit);
    }

    function setPlaybackContentCache(controller, nodes, complete) {
        controller.__readerSpeedPlaybackContent = Object.freeze({
            key: cacheKey(controller),
            nodes: Array.isArray(nodes) ? nodes : [],
            complete: complete === true,
        });
        return controller.__readerSpeedPlaybackContent;
    }

    async function prefetchPlaybackNodes(controller, rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        const reader = controller?.reader;
        if (!reader?.openResponse) return [];

        const cached = cachedPlaybackNodes(controller);
        if (cached) return cached;

        if (!reader.api?.content || !reader.model?.mergeNodes || !reader.documentRef || !reader.candidateId) {
            const fallback = Array.isArray(reader.nodes) ? reader.nodes.slice() : [];
            setPlaybackContentCache(controller, fallback, !reader.hasMore);
            return fallback;
        }

        const key = cacheKey(controller);
        let nodes = Array.isArray(reader.nodes) ? reader.nodes.slice() : [];
        let hasMore = Boolean(reader.hasMore);
        let nextNodeOrder = Number(reader.nextNodeOrder || nodes.length || 0);
        const limit = maxNodeLimit(rootObject);

        while (hasMore && cacheKey(controller) === key) {
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
            await yieldToBrowser(rootObject);
        }

        if (cacheKey(controller) !== key) return [];
        setPlaybackContentCache(controller, nodes, !hasMore);
        return nodes;
    }

    function adapterOptionsSignature(options = {}) {
        return JSON.stringify({
            displayScope: String(options.displayScope || ''),
            lineWidth: Number(options.lineWidth || 0),
            maxLines: Number(options.maxLines || 0),
            speedPerMinute: Number(options.speedPerMinute || 0),
        });
    }

    function workerAssetUrl(rootObject) {
        const versioner = rootObject?.ReaderResumeLifecycleV2?.versionedAsset;
        if (typeof versioner === 'function') return versioner('reader-speed-frame-worker.js');
        const version = String(
            rootObject?.document?.querySelector?.('meta[name="reader-preview-head"]')?.getAttribute?.('content') || '',
        ).trim();
        return version
            ? `reader-speed-frame-worker.js?v=${encodeURIComponent(version)}`
            : 'reader-speed-frame-worker.js';
    }

    function compilePlaybackFrames(controller, nodes, rootObject, options = controller?.adapterOptions?.() || {}) {
        const documentView = controller?.reader?.openResponse;
        if (!documentView || !Array.isArray(nodes)) return Promise.resolve([]);
        const WorkerCtor = rootObject?.Worker;
        if (typeof WorkerCtor !== 'function') {
            return yieldToBrowser(rootObject).then(() => (
                controller.adapter.buildPlaybackFrames(documentView, nodes, options).frames
            ));
        }

        return new Promise((resolve, reject) => {
            const worker = new WorkerCtor(workerAssetUrl(rootObject));
            const requestId = `reader-speed-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const finish = () => {
                try { worker.terminate?.(); } catch (_error) { /* best effort */ }
            };
            worker.onmessage = (event) => {
                const data = event?.data || {};
                if (data.id !== requestId) return;
                finish();
                if (!data.ok) {
                    reject(new Error(data.error_name || 'Speed reading frame worker failed'));
                    return;
                }
                resolve(Array.isArray(data.frames) ? data.frames : []);
            };
            worker.onerror = (event) => {
                finish();
                reject(new Error(event?.message || 'Speed reading frame worker failed'));
            };
            worker.postMessage({
                id: requestId,
                documentView,
                nodes,
                options,
            });
        });
    }

    function compiledFramesForCurrentOptions(controller) {
        const compiled = controller?.__readerSpeedCompiledFrames;
        if (!compiled || compiled.key !== cacheKey(controller) || !Array.isArray(compiled.frames)) return null;
        const currentSignature = adapterOptionsSignature(controller.adapterOptions?.() || {});
        return compiled.optionsSignature === currentSignature ? compiled.frames : null;
    }

    function applyCompiledFrames(controller, frames, key, optionsSignature) {
        if (!controller?.playback || cacheKey(controller) !== key || !Array.isArray(frames)) return false;
        if (adapterOptionsSignature(controller.adapterOptions?.() || {}) !== optionsSignature) return false;

        const before = controller.playback.snapshot?.() || {};
        controller.__readerSpeedCompiledFrames = Object.freeze({
            key,
            optionsSignature,
            frames,
        });
        controller.__readerSpeedStartSeed = null;
        controller.playback.setFrames(frames, { preserveIdentity: true });

        if (before.remaining_ms != null && controller.playback.state === before.state) {
            if (before.state === 'playing') {
                controller.playback.cancelTimer?.();
                controller.playback.remainingMs = before.remaining_ms;
                controller.playback.scheduleCurrent?.();
            } else if (before.state === 'paused') {
                controller.playback.remainingMs = before.remaining_ms;
            }
        }
        controller.updateControls?.();
        return true;
    }

    function startBackgroundPlaybackCompilation(controller, rootObject = typeof globalThis !== 'undefined' ? globalThis : null) {
        if (!controller?.reader?.openResponse) return null;
        const key = cacheKey(controller);
        const options = controller.adapterOptions?.() || {};
        const optionsSignature = adapterOptionsSignature(options);
        const jobKey = `${key}\u001f${optionsSignature}`;

        if (
            controller.__readerSpeedBackgroundPromise
            && controller.__readerSpeedBackgroundJobKey === jobKey
        ) return controller.__readerSpeedBackgroundPromise;

        const pending = Promise.resolve()
            .then(() => prefetchPlaybackNodes(controller, rootObject))
            .then((nodes) => {
                if (!nodes.length || cacheKey(controller) !== key) return null;
                return compilePlaybackFrames(controller, nodes, rootObject, options);
            })
            .then((frames) => {
                if (!frames || cacheKey(controller) !== key) return null;
                applyCompiledFrames(controller, frames, key, optionsSignature);
                return frames;
            })
            .catch((error) => {
                rootObject?.console?.warn?.('[Reader speed prefetch] background compilation failed', {
                    error_name: error?.name || 'Error',
                });
                return null;
            })
            .finally(() => {
                if (controller.__readerSpeedBackgroundJobKey === jobKey) {
                    controller.__readerSpeedBackgroundPromise = null;
                    controller.__readerSpeedBackgroundJobKey = null;
                }
            });

        controller.__readerSpeedBackgroundJobKey = jobKey;
        controller.__readerSpeedBackgroundPromise = pending;
        return pending;
    }

    function wrapEnsureAllContent(target, rootObject) {
        if (!target || typeof target.ensureAllContent !== 'function') return false;
        if (Object.prototype.hasOwnProperty.call(target, '__readerSpeedPrefetchEnsureWrapped')) return false;
        const original = target.ensureAllContent;
        target.ensureAllContent = async function ensurePlaybackSeedThenCompileInBackground(...args) {
            const reader = this.reader;
            if (!reader?.api?.content || !reader?.model?.mergeNodes) return original.apply(this, args);

            const compiled = compiledFramesForCurrentOptions(this);
            if (compiled) return cachedPlaybackNodes(this) || reader.nodes || [];

            const seed = seedPlaybackNodes(this);
            this.__readerSpeedStartSeed = seed;
            startBackgroundPlaybackCompilation(this, rootObject);
            return seed;
        };
        Object.defineProperty(target, '__readerSpeedPrefetchEnsureWrapped', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    function wrapRefreshFrames(target, rootObject) {
        if (!target || typeof target.refreshFrames !== 'function') return false;
        if (Object.prototype.hasOwnProperty.call(target, '__readerSpeedPrefetchFramesWrapped')) return false;
        const original = target.refreshFrames;
        target.refreshFrames = function refreshFramesFromFastSeed(options = {}) {
            const compiled = compiledFramesForCurrentOptions(this);
            if (compiled) {
                this.playback.setFrames(compiled, { preserveIdentity: options.preserveIdentity !== false });
                this.updateControls?.();
                return compiled;
            }

            const seed = Array.isArray(this.__readerSpeedStartSeed) && this.__readerSpeedStartSeed.length
                ? this.__readerSpeedStartSeed
                : seedPlaybackNodes(this);
            if (!seed.length || !this.reader?.openResponse) return original.call(this, options);

            const built = this.adapter.buildPlaybackFrames(
                this.reader.openResponse,
                seed,
                this.adapterOptions(),
            );
            this.playback.setFrames(built.frames, { preserveIdentity: options.preserveIdentity !== false });
            this.updateControls?.();

            if (cachedPlaybackNodes(this) && !compiledFramesForCurrentOptions(this)) {
                startBackgroundPlaybackCompilation(this, rootObject);
            }
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
        wrapRefreshFrames(Controller.prototype, rootObject);
        const controller = rootObject?.ReaderSpeedPlaybackUI?.getDefaultController?.();
        if (controller) {
            wrapEnsureAllContent(controller, rootObject);
            wrapRefreshFrames(controller, rootObject);
        }
        return true;
    }

    return {
        FALLBACK_MAX_NODE_LIMIT,
        START_SEED_LOOKBEHIND,
        START_SEED_NODE_LIMIT,
        adapterOptionsSignature,
        applyCompiledFrames,
        cacheKey,
        cachedPlaybackNodes,
        compilePlaybackFrames,
        compiledFramesForCurrentOptions,
        currentSemanticNodeId,
        install,
        maxNodeLimit,
        playbackContentCache,
        prefetchPlaybackNodes,
        seedPlaybackNodes,
        setPlaybackContentCache,
        startBackgroundPlaybackCompilation,
        workerAssetUrl,
        wrapEnsureAllContent,
        wrapRefreshFrames,
        yieldToBrowser,
    };
});
