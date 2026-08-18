(function (root, factory) {
    const api = factory(root || (typeof globalThis !== 'undefined' ? globalThis : null));
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.BookshelfDirectUpload = api;
        api.install(root);
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    const DEFAULT_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service.hf.space';
    const DIRECT_UPLOAD_THRESHOLD_BYTES = 8 * 1024 * 1024;
    const CONTROL_REQUEST_TIMEOUT_MS = 120000;
    const MIN_DIRECT_PUT_TIMEOUT_MS = 120000;
    const DIRECT_PUT_EXPIRY_SAFETY_SECONDS = 30;

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

    function requestUrl(input) {
        if (typeof input === 'string') return input;
        if (input && typeof input.url === 'string') return input.url;
        return String(input || '');
    }

    function isLegacyUploadRequest(input, init, rootObject = root) {
        const method = String(init?.method || 'GET').toUpperCase();
        if (method !== 'POST') return false;
        const raw = requestUrl(input);
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
        if (!file || typeof file.size !== 'number') return null;
        return file;
    }

    function isPdfFile(file) {
        const explicit = String(file?.type || '').trim().toLowerCase();
        const filename = String(file?.name || '').trim().toLowerCase();
        return explicit === 'application/pdf' || filename.endsWith('.pdf');
    }

    function updateUploadProgress(rootObject, percent, detail = '') {
        const bounded = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
        const uploadZone = rootObject?.document?.getElementById?.('uploadZone');
        const prompt = uploadZone?.querySelector?.('.upload-prompt');
        if (prompt) {
            const detailLine = detail ? `<br><small>${detail}</small>` : '';
            prompt.innerHTML = `⏳ 正在上传文件...<br><span>${bounded}%</span>${detailLine}`;
        }
        return bounded;
    }

    function monotonicNowMs(rootObject = root) {
        const performanceObject = rootObject?.performance
            || (typeof performance !== 'undefined' ? performance : null);
        if (typeof performanceObject?.now === 'function') {
            const value = Number(performanceObject.now());
            if (Number.isFinite(value)) return value;
        }
        return Date.now();
    }

    function metricMs(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return null;
        return Math.round(Math.max(0, numeric) * 10) / 10;
    }

    function metricRate(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return null;
        return Math.round(Math.max(0, numeric) * 1000) / 1000;
    }

    function deltaMetric(end, start) {
        const endValue = Number(end);
        const startValue = Number(start);
        if (!Number.isFinite(endValue) || !Number.isFinite(startValue) || endValue < startValue) return null;
        return metricMs(endValue - startValue);
    }

    function readPutResourceTiming(rootObject, uploadUrl) {
        const performanceObject = rootObject?.performance
            || (typeof performance !== 'undefined' ? performance : null);
        if (typeof performanceObject?.getEntriesByName !== 'function') {
            return { available: false };
        }
        try {
            const entries = performanceObject.getEntriesByName(uploadUrl, 'resource') || [];
            const entry = entries[entries.length - 1];
            if (!entry) return { available: false };
            return {
                available: true,
                duration_ms: metricMs(entry.duration),
                dns_ms: deltaMetric(entry.domainLookupEnd, entry.domainLookupStart),
                connect_ms: deltaMetric(entry.connectEnd, entry.connectStart),
                tls_ms: Number(entry.secureConnectionStart) > 0
                    ? deltaMetric(entry.connectEnd, entry.secureConnectionStart)
                    : null,
                request_wait_ms: deltaMetric(entry.responseStart, entry.requestStart),
                response_download_ms: deltaMetric(entry.responseEnd, entry.responseStart),
                next_hop_protocol: String(entry.nextHopProtocol || '') || null,
            };
        } catch (error) {
            return { available: false };
        }
    }

    function effectiveMiBPerSecond(byteSize, putMs) {
        const bytes = Number(byteSize);
        const elapsed = Number(putMs);
        if (!Number.isFinite(bytes) || bytes < 0 || !Number.isFinite(elapsed) || elapsed <= 0) return null;
        return metricRate((bytes / (1024 * 1024)) / (elapsed / 1000));
    }

    function emitUploadTiming(rootObject, detail) {
        const safeDetail = Object.freeze({ ...detail });
        rootObject?.console?.info?.('[atlas upload timing]', safeDetail);
        const CustomEventCtor = rootObject?.CustomEvent;
        if (typeof rootObject?.dispatchEvent === 'function' && typeof CustomEventCtor === 'function') {
            try {
                rootObject.dispatchEvent(new CustomEventCtor('atlas-upload-timing', { detail: safeDetail }));
            } catch (error) {
                // Console timing remains available even if a host cannot dispatch CustomEvent.
            }
        }
        return safeDetail;
    }

    async function fetchWithTimeout(fetchImpl, rootObject, input, init, timeoutMs, phase) {
        const AbortControllerCtor = rootObject?.AbortController || (typeof AbortController !== 'undefined' ? AbortController : null);
        if (!AbortControllerCtor || !timeoutMs) return fetchImpl(input, init);
        const controller = new AbortControllerCtor();
        const timer = (rootObject?.setTimeout || setTimeout)(() => controller.abort(), timeoutMs);
        try {
            return await fetchImpl(input, { ...(init || {}), signal: controller.signal });
        } catch (error) {
            if (error?.name === 'AbortError') {
                throw new Error(`${phase} timed out after ${Math.round(timeoutMs / 1000)} seconds`);
            }
            throw error;
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

    async function sha256Hex(file, rootObject = root) {
        const cryptoObject = rootObject?.crypto || (typeof crypto !== 'undefined' ? crypto : null);
        if (!cryptoObject?.subtle?.digest || typeof file?.arrayBuffer !== 'function') {
            throw new Error('Browser SHA-256 support is unavailable');
        }
        const bytes = await file.arrayBuffer();
        const digest = await cryptoObject.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest))
            .map((value) => value.toString(16).padStart(2, '0'))
            .join('');
    }

    function directPutTimeoutMs(session) {
        const expires = Number(session?.expires_in_seconds || 0);
        const usableSeconds = Math.max(0, expires - DIRECT_PUT_EXPIRY_SAFETY_SECONDS);
        return Math.max(MIN_DIRECT_PUT_TIMEOUT_MS, usableSeconds * 1000);
    }

    function validateSession(session, file, checksum) {
        const uploadId = String(session?.upload_id || '');
        const uploadUrl = String(session?.upload_url || '');
        const uploadMethod = String(session?.upload_method || '').toUpperCase();
        const completionToken = String(session?.completion_token || '');
        const sessionChecksum = String(session?.checksum_sha256 || '').toLowerCase();
        const byteSize = Number(session?.byte_size || 0);
        if (
            !uploadId
            || !uploadUrl.startsWith('https://')
            || uploadMethod !== 'PUT'
            || !completionToken
            || byteSize !== file.size
            || sessionChecksum !== checksum
            || !session?.upload_headers
            || typeof session.upload_headers !== 'object'
        ) {
            throw new Error('Direct upload session response is invalid');
        }
        return { uploadId, uploadUrl, uploadMethod, completionToken };
    }

    async function uploadDirectFile(file, options = {}) {
        const rootObject = options.rootObject || root;
        const fetchImpl = options.fetchImpl || rootObject?.fetch?.bind(rootObject);
        const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl || resolveApiBaseUrl(rootObject));
        if (!fetchImpl) throw new Error('Upload transport is unavailable');
        if (!isPdfFile(file)) throw new Error('Direct object upload currently supports PDF files only');

        const totalStarted = monotonicNowMs(rootObject);

        updateUploadProgress(rootObject, 0, '正在计算 PDF 校验值…');
        const shaStarted = monotonicNowMs(rootObject);
        const checksum = await sha256Hex(file, rootObject);
        const sha256Ms = metricMs(monotonicNowMs(rootObject) - shaStarted);

        updateUploadProgress(rootObject, 0, '正在创建安全直传会话…');
        const createStarted = monotonicNowMs(rootObject);
        const createResponse = await fetchWithTimeout(
            fetchImpl,
            rootObject,
            `${apiBaseUrl}/api/v1/direct-upload-sessions`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    filename: file.name || 'upload.pdf',
                    byte_size: file.size,
                    checksum_sha256: checksum,
                    content_type: 'application/pdf',
                }),
            },
            CONTROL_REQUEST_TIMEOUT_MS,
            'Create direct upload session',
        );
        await requireOk(createResponse, 'Create direct upload session');
        const session = await createResponse.json();
        const validated = validateSession(session, file, checksum);
        const createSessionMs = metricMs(monotonicNowMs(rootObject) - createStarted);

        updateUploadProgress(rootObject, 0, '正在直接上传到 HF Storage Bucket…');
        const putStarted = monotonicNowMs(rootObject);
        const putResponse = await fetchWithTimeout(
            fetchImpl,
            rootObject,
            validated.uploadUrl,
            {
                method: validated.uploadMethod,
                headers: { ...session.upload_headers },
                body: file,
            },
            directPutTimeoutMs(session),
            'Direct object upload',
        );
        await requireOk(putResponse, 'Direct object upload');
        const putMs = metricMs(monotonicNowMs(rootObject) - putStarted);
        const putResourceTiming = readPutResourceTiming(rootObject, validated.uploadUrl);

        updateUploadProgress(rootObject, 100, '文件已上传，正在提交处理任务…');
        const completeStarted = monotonicNowMs(rootObject);
        const completeResponse = await fetchWithTimeout(
            fetchImpl,
            rootObject,
            `${apiBaseUrl}/api/v1/direct-upload-sessions/${encodeURIComponent(validated.uploadId)}/complete`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ completion_token: validated.completionToken }),
            },
            CONTROL_REQUEST_TIMEOUT_MS,
            'Complete direct upload',
        );
        const completeMs = metricMs(monotonicNowMs(rootObject) - completeStarted);
        const totalUploadMs = metricMs(monotonicNowMs(rootObject) - totalStarted);

        emitUploadTiming(rootObject, {
            upload_route: 'direct_single_put',
            file_size_bytes: Number(file.size),
            sha256_ms: sha256Ms,
            create_session_ms: createSessionMs,
            preflight_ms: null,
            preflight_observable: false,
            put_ms: putMs,
            complete_ms: completeMs,
            total_upload_ms: totalUploadMs,
            effective_MiB_per_second: effectiveMiBPerSecond(file.size, putMs),
            throughput_basis: 'put_ms',
            put_resource_timing: putResourceTiming,
        });
        return completeResponse;
    }

    function createDirectUploadFetch(rootObject = root, options = {}) {
        const fetchImpl = options.fetchImpl || rootObject?.fetch?.bind(rootObject);
        if (!fetchImpl) return null;
        const thresholdBytes = Number.isFinite(options.thresholdBytes)
            ? Math.max(1, Number(options.thresholdBytes))
            : DIRECT_UPLOAD_THRESHOLD_BYTES;

        return async function directUploadFetch(input, init) {
            if (!isStagingEnvironment(rootObject) || !isLegacyUploadRequest(input, init, rootObject)) {
                return fetchImpl(input, init);
            }
            const file = uploadFileFromBody(init?.body);
            if (!file || file.size < thresholdBytes || !isPdfFile(file)) {
                return fetchImpl(input, init);
            }
            rootObject?.console?.info?.('[staging] using direct object upload transport', {
                filename: file.name || '',
                byteSize: file.size,
            });
            try {
                return await uploadDirectFile(file, {
                    rootObject,
                    fetchImpl,
                    apiBaseUrl: options.apiBaseUrl || resolveApiBaseUrl(rootObject),
                });
            } catch (error) {
                rootObject?.console?.error?.('[direct upload] failed', {
                    filename: file.name || '',
                    byteSize: file.size,
                    message: error?.message || String(error),
                });
                throw error;
            }
        };
    }

    function install(rootObject = root, options = {}) {
        if (!rootObject || rootObject.__directLargeUploadInstalled || !isStagingEnvironment(rootObject)) return false;
        const wrapped = createDirectUploadFetch(rootObject, options);
        if (!wrapped) return false;
        rootObject.fetch = wrapped;
        Object.defineProperty(rootObject, '__directLargeUploadInstalled', {
            configurable: false,
            enumerable: false,
            writable: false,
            value: true,
        });
        return true;
    }

    return {
        CONTROL_REQUEST_TIMEOUT_MS,
        DEFAULT_API_BASE_URL,
        DIRECT_UPLOAD_THRESHOLD_BYTES,
        createDirectUploadFetch,
        directPutTimeoutMs,
        effectiveMiBPerSecond,
        emitUploadTiming,
        fetchWithTimeout,
        install,
        isLegacyUploadRequest,
        isPdfFile,
        isStagingEnvironment,
        metricMs,
        monotonicNowMs,
        normalizeBaseUrl,
        readPutResourceTiming,
        requestUrl,
        requireOk,
        resolveApiBaseUrl,
        sha256Hex,
        updateUploadProgress,
        uploadDirectFile,
        uploadFileFromBody,
        validateSession,
    };
});
