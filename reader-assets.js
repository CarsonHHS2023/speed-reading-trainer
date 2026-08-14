(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderAssetRendererV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

    class ReaderAssetResolverV2 {
        constructor(options = {}) {
            this.api = options.api;
            if (!this.api) throw new Error('Reader v2 API client is required');
            this.cache = new Map();
        }

        reset() {
            this.cache.clear();
        }

        cacheKey(candidateId, assetId) {
            return `${String(candidateId)}:${String(assetId)}`;
        }

        async metadata(documentRef, candidateId, assetId) {
            const key = this.cacheKey(candidateId, assetId);
            if (!this.cache.has(key)) {
                this.cache.set(key, this.api.asset(documentRef, assetId, { candidateId }));
            }
            try {
                return await this.cache.get(key);
            } catch (error) {
                this.cache.delete(key);
                throw error;
            }
        }

        async resolveFirstAvailable(documentRef, candidateId, assetRefs) {
            for (const assetId of assetRefs || []) {
                let metadata;
                try {
                    metadata = await this.metadata(documentRef, candidateId, assetId);
                } catch (error) {
                    if (error && error.code === 'reader_asset_not_found') continue;
                    throw error;
                }
                if (
                    metadata
                    && metadata.delivery_state === 'available'
                    && IMAGE_MEDIA_TYPES.has(metadata.rendition_media_type)
                ) {
                    return {
                        metadata,
                        contentUrl: this.api.assetContentUrl(documentRef, assetId, { candidateId }),
                    };
                }
            }
            return null;
        }
    }

    function defaultLabel(nodeType) {
        return nodeType === 'figure' ? '图像暂不可用' : nodeType === 'table' ? '表格暂不可用' : nodeType === 'formula' ? '公式暂不可用' : '资源暂不可用';
    }

    function cleanDisplayText(value) {
        const text = typeof value === 'string' ? value.trim() : '';
        if (!text) return '';
        if (/\b(?:label|bbox|content)\s*:/i.test(text)) return '';
        return text;
    }

    function clear(target) {
        while (target && target.firstChild) target.removeChild(target.firstChild);
    }

    function renderPlaceholder(documentObject, target, nodeType, fallbackText) {
        clear(target);
        const placeholder = documentObject.createElement('div');
        placeholder.className = 'reader-v2-placeholder';
        placeholder.textContent = cleanDisplayText(fallbackText) || defaultLabel(nodeType);
        target.appendChild(placeholder);
    }

    function appAccessController() {
        return typeof globalThis !== 'undefined' ? globalThis.AppAccess : null;
    }

    async function protectedContentUrl(contentUrl) {
        const access = appAccessController();
        if (!access || typeof access.fetchBlobUrl !== 'function') {
            return { url: contentUrl, revoke: null };
        }
        const objectUrl = await access.fetchBlobUrl(contentUrl);
        const revoke = () => {
            const URLCtor = typeof globalThis !== 'undefined' ? globalThis.URL : null;
            if (objectUrl && URLCtor && typeof URLCtor.revokeObjectURL === 'function') {
                URLCtor.revokeObjectURL(objectUrl);
            }
        };
        return { url: objectUrl, revoke };
    }

    async function renderAssetInto(options = {}) {
        const {
            documentObject,
            resolver,
            documentRef,
            candidateId,
            assetRefs,
            nodeType,
            fallbackText,
            target,
        } = options;
        if (!documentObject || !resolver || !target) return null;

        const resolved = await resolver.resolveFirstAvailable(documentRef, candidateId, assetRefs || []);
        if (!resolved) {
            renderPlaceholder(documentObject, target, nodeType, fallbackText);
            return null;
        }

        let protectedUrl;
        try {
            protectedUrl = await protectedContentUrl(resolved.contentUrl);
        } catch (error) {
            renderPlaceholder(documentObject, target, nodeType, fallbackText);
            return null;
        }

        clear(target);
        const figure = documentObject.createElement('figure');
        figure.className = 'reader-v2-asset';
        const image = documentObject.createElement('img');
        image.className = 'reader-v2-asset-image';
        image.src = protectedUrl.url;
        const safeFallback = cleanDisplayText(fallbackText);
        image.alt = cleanDisplayText(resolved.metadata.alt_text)
            || cleanDisplayText(resolved.metadata.caption)
            || safeFallback
            || defaultLabel(nodeType);
        image.onload = () => protectedUrl.revoke?.();
        image.onerror = () => {
            protectedUrl.revoke?.();
            renderPlaceholder(documentObject, target, nodeType, fallbackText);
        };
        figure.appendChild(image);
        const captionText = cleanDisplayText(resolved.metadata.caption);
        if (captionText) {
            const caption = documentObject.createElement('figcaption');
            caption.className = 'reader-v2-asset-caption';
            caption.textContent = captionText;
            figure.appendChild(caption);
        }
        target.appendChild(figure);
        return resolved;
    }

    return {
        IMAGE_MEDIA_TYPES,
        ReaderAssetResolverV2,
        cleanDisplayText,
        defaultLabel,
        protectedContentUrl,
        renderAssetInto,
        renderPlaceholder,
    };
});