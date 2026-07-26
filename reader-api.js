(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderApiV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const CONTRACT_VERSION = '2';
    const DEFAULT_NODE_LIMIT = 100;
    const MAX_NODE_LIMIT = 500;

    class ReaderApiError extends Error {
        constructor(message, options = {}) {
            super(message);
            this.name = 'ReaderApiError';
            this.status = options.status || 0;
            this.code = options.code || 'reader_request_failed';
            this.safeMessage = options.safeMessage || message;
            this.cause = options.cause;
        }
    }

    function normalizeBaseUrl(value) {
        return String(value || '').replace(/\/+$/, '');
    }

    function resolveBaseUrl(rootObject) {
        const configured = rootObject && (
            rootObject.READER_API_BASE_URL ||
            rootObject.API_BASE_URL_OVERRIDE ||
            rootObject.API_BASE_URL
        );
        return normalizeBaseUrl(configured || 'https://carsonhhs-pdf-ocr-service.hf.space');
    }

    function assertIdentity(payload, expected = {}) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new ReaderApiError('Reader returned an invalid response.', { code: 'reader_invalid_response' });
        }
        if (payload.contract_version !== CONTRACT_VERSION) {
            throw new ReaderApiError('Reader contract version is not supported.', { code: 'reader_contract_version_unsupported' });
        }
        for (const [field, value] of Object.entries(expected)) {
            if (value !== undefined && value !== null && payload[field] !== value) {
                throw new ReaderApiError('Reader response identity changed while reading.', { code: 'reader_identity_changed' });
            }
        }
        if (!payload.document_ref || !payload.candidate_id || !payload.candidate_schema_id) {
            throw new ReaderApiError('Reader response identity is incomplete.', { code: 'reader_invalid_identity' });
        }
        if (Number(payload.candidate_schema_version) !== 2) {
            throw new ReaderApiError('Reader candidate schema version is not supported.', { code: 'reader_candidate_schema_unsupported' });
        }
        return payload;
    }

    function safeDetail(body, fallback) {
        const detail = body && body.detail;
        if (detail && typeof detail === 'object') {
            return {
                code: typeof detail.code === 'string' ? detail.code : 'reader_request_failed',
                message: typeof detail.message === 'string' ? detail.message : fallback,
            };
        }
        return { code: 'reader_request_failed', message: fallback };
    }

    class ReaderApiClientV2 {
        constructor(options = {}) {
            this.baseUrl = normalizeBaseUrl(options.baseUrl || resolveBaseUrl(typeof window !== 'undefined' ? window : null));
            this.fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
            if (!this.fetchImpl) throw new Error('fetch implementation is required');
        }

        async requestJson(path) {
            let response;
            try {
                response = await this.fetchImpl(`${this.baseUrl}${path}`, {
                    headers: { Accept: 'application/json' },
                });
            } catch (error) {
                throw new ReaderApiError('Unable to reach Reader service.', {
                    code: 'reader_network_unavailable',
                    safeMessage: '无法连接阅读服务。',
                    cause: error,
                });
            }

            let body = null;
            try {
                body = await response.json();
            } catch (error) {
                if (response.ok) {
                    throw new ReaderApiError('Reader returned invalid JSON.', {
                        status: response.status,
                        code: 'reader_invalid_response',
                        cause: error,
                    });
                }
            }

            if (!response.ok) {
                const detail = safeDetail(body, `Reader request failed (${response.status}).`);
                throw new ReaderApiError(detail.message, {
                    status: response.status,
                    code: detail.code,
                    safeMessage: detail.message,
                });
            }
            return body;
        }

        async open(documentRef) {
            const doc = encodeURIComponent(String(documentRef));
            return assertIdentity(await this.requestJson(`/api/reader/v2/documents/${doc}`), {
                document_ref: String(documentRef),
            });
        }

        async navigation(documentRef, options = {}) {
            const doc = encodeURIComponent(String(documentRef));
            return assertIdentity(
                await this.requestJson(`/api/reader/v2/documents/${doc}/navigation`),
                {
                    document_ref: String(documentRef),
                    candidate_id: options.candidateId,
                },
            );
        }

        async content(documentRef, options = {}) {
            const startNodeOrder = Math.max(0, Number(options.startNodeOrder || 0));
            const limit = Math.max(1, Math.min(MAX_NODE_LIMIT, Number(options.limit || DEFAULT_NODE_LIMIT)));
            const params = new URLSearchParams({
                start_node_order: String(startNodeOrder),
                limit: String(limit),
            });
            if (options.candidateId) params.set('candidate_id', options.candidateId);
            const doc = encodeURIComponent(String(documentRef));
            return assertIdentity(
                await this.requestJson(`/api/reader/v2/documents/${doc}/content?${params.toString()}`),
                {
                    document_ref: String(documentRef),
                    candidate_id: options.candidateId,
                },
            );
        }

        async asset(documentRef, assetId, options = {}) {
            if (!options.candidateId) throw new Error('candidateId is required for Reader v2 assets');
            const doc = encodeURIComponent(String(documentRef));
            const asset = encodeURIComponent(String(assetId));
            const params = new URLSearchParams({ candidate_id: String(options.candidateId) });
            return assertIdentity(
                await this.requestJson(`/api/reader/v2/documents/${doc}/assets/${asset}?${params.toString()}`),
                {
                    document_ref: String(documentRef),
                    candidate_id: String(options.candidateId),
                },
            );
        }

        assetContentUrl(documentRef, assetId, options = {}) {
            if (!options.candidateId) throw new Error('candidateId is required for Reader v2 assets');
            const doc = encodeURIComponent(String(documentRef));
            const asset = encodeURIComponent(String(assetId));
            const params = new URLSearchParams({ candidate_id: String(options.candidateId) });
            return `${this.baseUrl}/api/reader/v2/documents/${doc}/assets/${asset}/content?${params.toString()}`;
        }
    }

    return {
        CONTRACT_VERSION,
        DEFAULT_NODE_LIMIT,
        MAX_NODE_LIMIT,
        ReaderApiClientV2,
        ReaderApiError,
        assertIdentity,
        normalizeBaseUrl,
        resolveBaseUrl,
        safeDetail,
    };
});