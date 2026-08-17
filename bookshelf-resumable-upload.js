(function (root, factory) {
    const api = factory(root || (typeof globalThis !== 'undefined' ? globalThis : null));
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.BookshelfResumableUpload = api;
        api.install(root);
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    const DEFAULT_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service.hf.space';
    const LARGE_UPLOAD_THRESHOLD_BYTES = 16 * 1024 * 1024;
    const REQUEST_TIMEOUT_MS = 120000;
    const MAX_CHUNK_ATTEMPTS = 3;

    function normalizeBaseUrl(value) {
        return String(value || '').replace(/\/+$/, '');
    }

    function resolveApiBaseUrl(rootObject = root) {
        return normalizeBaseUrl(
            rootObject?.READER_API_BASE_URL
            || rootObject?.API_BASE_URL_OVERRIDE
            || rootObject?.SPEED_READING_CONFIG?.apiBaseUrl
            || DEFAULT_API_BASE_URL,
        );
    }

    function isStagingEnvironment(rootObject = root) {
        const environment = String(rootObject?.SPEED_READING_CONFIG?.environment || '');
        return environment === 'staging' || environment === 'staging-preview';
    }

    function requestUrl(input, rootObject = root) {
        if (typeof input === 'string') return input;
        if (input && typeof input.url === 'string') return input.url;
        return String(input || '');
    }

    function isLegacyUploadRequest(input, init, rootObject = root) {
        const method = String(init?.method || 'GET').toUpperCase();
        if (method !== 'POST') return false;
        const raw = requestUrl(input, rootObject);
        let parsed;
        try {
            parsed = new (rootObject?.URL || URL)(raw, rootObject?.location?.href || DEFAULT_API_BASE_URL);
        } catch (error) {
            return false;
        }
        return parsed.pathname.endsWith('/api/v1/upload');
    }

    function uploadFileFromBody(body) {
        if (!body || typeof body.get !== 'function') return null;
        const file = body.get('file');
        if (!file || typeof file.size !== 'number' || typeof file.slice !== 'function') return null;
        return file;
    }

    function updateUploadProgress(rootObject, uploadedBytes, totalBytes) {
        const percent = totalBytes > 0
            ? Math.max(0, Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)))
            : 0;
        const uploadZone = rootObject?.document?.getElementById?.('uploadZone');
        const prompt = uploadZone?.querySelector?.('.upload-prompt');
        if (prompt) {
            prompt.innerHTML = `⏳ 正在上传文件...<br><span>${percent}%</span>`;
        }
        return percent;
    }

    function delay(rootObject, milliseconds) {
        const timer = rootObject?.setTimeout || setTimeout;
        return new Promise((resolve) => timer(resolve, milliseconds));
    }

    async function fetchWithTimeout(fetchImpl, rootObject, input, init = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
        const AbortControllerCtor = rootObject?.AbortController || (typeof AbortController !== 'undefined' ? AbortController : null);
        if (!AbortControllerCtor || !timeoutMs) return fetchImpl(input, init);
        const controller = new AbortControllerCtor();
        const timer = (rootObject?.setTimeout || setTimeout)(() => controller.abort(), timeoutMs);
        try {
            return await fetchImpl(input, { ...init, signal: controller.signal });
        } finally {
            (rootObject?.clearTimeout || clearTimeout)(timer);
        }
    }

    async function requireOk(response, phase) {
        if (response?.ok) return response;
        const status = Number(response?.status || 0);
        let detail = '';
        try {
            const payload = await response.json();
            detail = payload?.detail ? `: ${payload.detail}` : '';
        } catch (error) {
            detail = '';
        }
        throw new Error(`${phase} failed (HTTP ${status || 0})${detail}`);
    }

    async function uploadLargeFile(file, options = {}) {
        const rootObject = options.rootObject || root;
        const fetchImpl = options.fetchImpl || rootObject?.fetch?.bind(rootObject);
        const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl || resolveApiBaseUrl(rootObject));
        if (!fetchImpl) throw new Error('Upload transport is unavailable');

        const createResponse = await fetchWithTimeout(
            fetchImpl,
            rootObject,
            `${apiBaseUrl}/api/v1/upload-sessions`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: file.name || 'upload.pdf',
                    byte_size: file.size,
                    content_type: file.type || 'application/octet-stream',
                }),
            },
        );
        await requireOk(createResponse, 'Create upload session');
        const session = await createResponse.json();
        const uploadId = String(session.upload_id || '');
        const chunkSize = Number(session.chunk_size_bytes || 0);
        const chunkCount = Number(session.chunk_count || 0);
        if (!uploadId || !Number.isInteger(chunkSize) || chunkSize <= 0 || !Number.isInteger(chunkCount) || chunkCount <= 0) {
            throw new Error('Upload session response is invalid');
        }

        let uploadedBytes = 0;
        try {
            for (let index = 0; index < chunkCount; index += 1) {
                const start = index * chunkSize;
                const end = Math.min(file.size, start + chunkSize);
                const chunk = file.slice(start, end);
                let lastError = null;
                for (let attempt = 1; attempt <= MAX_CHUNK_ATTEMPTS; attempt += 1) {
                    try {
                        const chunkResponse = await fetchWithTimeout(
                            fetchImpl,
                            rootObject,
                            `${apiBaseUrl}/api/v1/upload-sessions/${encodeURIComponent(uploadId)}/chunks/${index}`,
                            {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/octet-stream' },
                                body: chunk,
                            },
                        );
                        await requireOk(chunkResponse, `Upload chunk ${index + 1}/${chunkCount}`);
                        lastError = null;
                        break;
                    } catch (error) {
                        lastError = error;
                        if (attempt < MAX_CHUNK_ATTEMPTS) await delay(rootObject, 500 * attempt);
                    }
                }
                if (lastError) throw lastError;
                uploadedBytes = end;
                updateUploadProgress(rootObject, uploadedBytes, file.size);
            }

            const completeResponse = await fetchWithTimeout(
                fetchImpl,
                rootObject,
                `${apiBaseUrl}/api/v1/upload-sessions/${encodeURIComponent(uploadId)}/complete`,
                { method: 'POST' },
            );
            return completeResponse;
        } catch (error) {
            try {
                await fetchWithTimeout(
                    fetchImpl,
                    rootObject,
                    `${apiBaseUrl}/api/v1/upload-sessions/${encodeURIComponent(uploadId)}`,
                    { method: 'DELETE' },
                    15000,
                );
            } catch (abortError) {
                rootObject?.console?.warn?.('[resumable upload] cleanup failed', abortError);
            }
            throw error;
        }
    }

    function createResumableFetch(rootObject = root, options = {}) {
        const fetchImpl = options.fetchImpl || rootObject?.fetch?.bind(rootObject);
        if (!fetchImpl) return null;
        const thresholdBytes = Number.isFinite(options.thresholdBytes)
            ? Math.max(1, Number(options.thresholdBytes))
            : LARGE_UPLOAD_THRESHOLD_BYTES;

        return async function resumableFetch(input, init) {
            if (!isStagingEnvironment(rootObject) || !isLegacyUploadRequest(input, init, rootObject)) {
                return fetchImpl(input, init);
            }
            const file = uploadFileFromBody(init?.body);
            if (!file || file.size < thresholdBytes) return fetchImpl(input, init);
            rootObject?.console?.info?.('[staging] using resumable upload transport', {
                filename: file.name || '',
                byteSize: file.size,
            });
            return uploadLargeFile(file, {
                rootObject,
                fetchImpl,
                apiBaseUrl: options.apiBaseUrl || resolveApiBaseUrl(rootObject),
            });
        };
    }

    function install(rootObject = root, options = {}) {
        if (!rootObject || rootObject.__resumableLargeUploadInstalled || !isStagingEnvironment(rootObject)) return false;
        const wrapped = createResumableFetch(rootObject, options);
        if (!wrapped) return false;
        rootObject.fetch = wrapped;
        Object.defineProperty(rootObject, '__resumableLargeUploadInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    return {
        DEFAULT_API_BASE_URL,
        LARGE_UPLOAD_THRESHOLD_BYTES,
        MAX_CHUNK_ATTEMPTS,
        REQUEST_TIMEOUT_MS,
        createResumableFetch,
        fetchWithTimeout,
        install,
        isLegacyUploadRequest,
        isStagingEnvironment,
        normalizeBaseUrl,
        requestUrl,
        resolveApiBaseUrl,
        updateUploadProgress,
        uploadFileFromBody,
        uploadLargeFile,
    };
});
