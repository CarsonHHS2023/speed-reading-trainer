(function (root, factory) {
    const api = factory(root || (typeof globalThis !== 'undefined' ? globalThis : null));
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.BookshelfUploadCapabilities = api;
        api.install(root);
    }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function (root) {
    'use strict';

    const DEFAULT_API_BASE_URL = 'https://carsonhhs-pdf-ocr-service.hf.space';
    const CAPABILITY_PATH = '/api/v1/upload-capabilities';
    const CAPABILITY_SCHEMA_VERSION = 1;
    const CAPABILITY_CACHE_TTL_MS = 60 * 1000;
    const CAPABILITY_REQUEST_TIMEOUT_MS = 10000;

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

    function inferredFileType(file) {
        const filename = String(file?.name || '').trim().toLowerCase();
        if (filename.endsWith('.pdf')) return 'pdf';
        if (filename.endsWith('.txt')) return 'txt';
        const explicit = String(file?.type || '').trim().toLowerCase();
        if (explicit === 'application/pdf') return 'pdf';
        if (explicit === 'text/plain') return 'txt';
        return '';
    }

    function positiveInteger(value) {
        const numeric = Number(value);
        return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
    }

    function nonNegativeInteger(value) {
        const numeric = Number(value);
        return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : null;
    }

    function stringList(value) {
        if (!Array.isArray(value)) return null;
        const normalized = value.map((item) => String(item || '').trim().toLowerCase());
        if (normalized.some((item) => !item)) return null;
        return normalized;
    }

    function validateCapabilities(payload) {
        if (!payload || Number(payload.schema_version) !== CAPABILITY_SCHEMA_VERSION) return null;
        const applicationMaxBytes = positiveInteger(payload.application_max_bytes);
        const supportedFileTypes = stringList(payload.supported_file_types);
        const directUploadFileTypes = stringList(payload.direct_upload_file_types);
        const directSinglePutMaxBytes = nonNegativeInteger(payload.direct_single_put_max_bytes);
        const resumableUploadFileTypes = stringList(payload.resumable_upload_file_types);
        const resumableTransportMaxBytes = positiveInteger(payload.resumable_transport_max_bytes);
        if (
            applicationMaxBytes === null
            || supportedFileTypes === null
            || typeof payload.direct_upload_available !== 'boolean'
            || directUploadFileTypes === null
            || directSinglePutMaxBytes === null
            || typeof payload.resumable_upload_available !== 'boolean'
            || resumableUploadFileTypes === null
            || resumableTransportMaxBytes === null
        ) {
            return null;
        }
        if (payload.direct_upload_available && directSinglePutMaxBytes <= 0) return null;
        return Object.freeze({
            schema_version: CAPABILITY_SCHEMA_VERSION,
            application_max_bytes: applicationMaxBytes,
            supported_file_types: Object.freeze([...supportedFileTypes]),
            direct_upload_available: payload.direct_upload_available,
            direct_upload_file_types: Object.freeze([...directUploadFileTypes]),
            direct_single_put_max_bytes: directSinglePutMaxBytes,
            resumable_upload_available: payload.resumable_upload_available,
            resumable_upload_file_types: Object.freeze([...resumableUploadFileTypes]),
            resumable_transport_max_bytes: resumableTransportMaxBytes,
        });
    }

    async function fetchWithTimeout(fetchImpl, rootObject, input, init, timeoutMs) {
        const AbortControllerCtor = rootObject?.AbortController || (typeof AbortController !== 'undefined' ? AbortController : null);
        if (!AbortControllerCtor || !timeoutMs) return fetchImpl(input, init);
        const controller = new AbortControllerCtor();
        const timer = (rootObject?.setTimeout || setTimeout)(() => controller.abort(), timeoutMs);
        try {
            return await fetchImpl(input, { ...(init || {}), signal: controller.signal });
        } finally {
            (rootObject?.clearTimeout || clearTimeout)(timer);
        }
    }

    function createClient(rootObject = root, options = {}) {
        const fetchImpl = options.fetchImpl || rootObject?.fetch?.bind(rootObject);
        const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl || resolveApiBaseUrl(rootObject));
        const cacheTtlMs = Number.isFinite(options.cacheTtlMs)
            ? Math.max(0, Number(options.cacheTtlMs))
            : CAPABILITY_CACHE_TTL_MS;
        const timeoutMs = Number.isFinite(options.timeoutMs)
            ? Math.max(1, Number(options.timeoutMs))
            : CAPABILITY_REQUEST_TIMEOUT_MS;
        let cachedCapabilities = null;
        let cachedAtMs = 0;
        let inFlight = null;

        function nowMs() {
            const value = Number(rootObject?.Date?.now?.() ?? Date.now());
            return Number.isFinite(value) ? value : Date.now();
        }

        function peekCapabilities() {
            if (!cachedCapabilities || cacheTtlMs === 0) return null;
            if (nowMs() - cachedAtMs > cacheTtlMs) return null;
            return cachedCapabilities;
        }

        async function requestCapabilities() {
            if (!fetchImpl || !isStagingEnvironment(rootObject)) return null;
            const existing = peekCapabilities();
            if (existing) return existing;
            if (inFlight) return inFlight;
            inFlight = (async () => {
                try {
                    const response = await fetchWithTimeout(
                        fetchImpl,
                        rootObject,
                        `${apiBaseUrl}${CAPABILITY_PATH}`,
                        { method: 'GET', headers: { Accept: 'application/json' } },
                        timeoutMs,
                    );
                    if (!response?.ok) {
                        throw new Error(`HTTP ${Number(response?.status || 0)}`);
                    }
                    const capabilities = validateCapabilities(await response.json());
                    if (!capabilities) throw new Error('invalid capability schema');
                    cachedCapabilities = capabilities;
                    cachedAtMs = nowMs();
                    return capabilities;
                } catch (error) {
                    rootObject?.console?.warn?.('[upload capabilities] unavailable; preserving existing upload routing', {
                        message: error?.message || String(error),
                    });
                    return null;
                } finally {
                    inFlight = null;
                }
            })();
            return inFlight;
        }

        function localAdmission(file, capabilities) {
            if (!file || !capabilities) return { allowed: true, reason: null, fileType: '' };
            const fileType = inferredFileType(file);
            if (!fileType || !capabilities.supported_file_types.includes(fileType)) {
                return {
                    allowed: false,
                    status: 400,
                    reason: 'Unsupported file type. Only PDF and TXT files are accepted.',
                    fileType,
                };
            }
            if (Number(file.size) > capabilities.application_max_bytes) {
                return {
                    allowed: false,
                    status: 413,
                    reason: `Book source exceeds the current application upload limit of ${capabilities.application_max_bytes} bytes`,
                    fileType,
                };
            }
            return { allowed: true, reason: null, fileType };
        }

        async function preflightFile(file) {
            const capabilities = await requestCapabilities();
            if (!capabilities) {
                return {
                    allowed: true,
                    capabilities: null,
                    reason: null,
                    fileType: inferredFileType(file),
                };
            }
            return { ...localAdmission(file, capabilities), capabilities };
        }

        function rejectionResponse(status, detail) {
            const ResponseCtor = rootObject?.Response || (typeof Response !== 'undefined' ? Response : null);
            if (!ResponseCtor) {
                const error = new Error(detail);
                error.status = status;
                throw error;
            }
            return new ResponseCtor(JSON.stringify({ detail }), {
                status,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        function createGuardedFetch() {
            if (!fetchImpl) return null;
            return async function capabilityGuardFetch(input, init) {
                if (!isStagingEnvironment(rootObject) || !isLegacyUploadRequest(input, init, rootObject)) {
                    return fetchImpl(input, init);
                }
                const file = uploadFileFromBody(init?.body);
                if (!file) return fetchImpl(input, init);
                const admission = await preflightFile(file);
                if (!admission.allowed) {
                    rootObject?.console?.warn?.('[upload capabilities] rejected before upload transport', {
                        filename: file.name || '',
                        byteSize: Number(file.size),
                        status: admission.status,
                        reason: admission.reason,
                    });
                    return rejectionResponse(admission.status, admission.reason);
                }
                return fetchImpl(input, init);
            };
        }

        function install() {
            if (!rootObject || rootObject.__uploadCapabilityGuardInstalled || !isStagingEnvironment(rootObject)) return false;
            const wrapped = createGuardedFetch();
            if (!wrapped) return false;
            rootObject.fetch = wrapped;
            Object.defineProperty(rootObject, '__uploadCapabilityGuardInstalled', {
                configurable: false,
                enumerable: false,
                writable: false,
                value: true,
            });
            return true;
        }

        return {
            install,
            requestCapabilities,
            peekCapabilities,
            preflightFile,
            localAdmission,
            createGuardedFetch,
        };
    }

    const defaultClient = createClient(root);
    return {
        CAPABILITY_CACHE_TTL_MS,
        CAPABILITY_PATH,
        CAPABILITY_REQUEST_TIMEOUT_MS,
        CAPABILITY_SCHEMA_VERSION,
        createClient,
        inferredFileType,
        install: defaultClient.install,
        isLegacyUploadRequest,
        isStagingEnvironment,
        normalizeBaseUrl,
        peekCapabilities: defaultClient.peekCapabilities,
        preflightFile: defaultClient.preflightFile,
        requestCapabilities: defaultClient.requestCapabilities,
        resolveApiBaseUrl,
        uploadFileFromBody,
        validateCapabilities,
    };
});
