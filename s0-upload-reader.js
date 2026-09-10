(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) {
        root.AtlasS0UploadReader = api;
        api.observer = new api.UploadReaderTelemetry(root);
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const STAGING = 'https://carsonhhs-pdf-ocr-service-staging.hf.space';
    const SHA = /^[0-9a-f]{40}$/;
    class UploadReaderTelemetry {
        constructor(root) {
            this.root = root;
            this.active = null;
            this.pending = 0;
            this.lifecycleReady = false;
            try {
                root.document?.addEventListener('visibilitychange', () => {
                    if (root.document.visibilityState !== 'visible') this.invalidate();
                });
                root.document?.addEventListener('freeze', () => this.invalidate());
                root.addEventListener?.('pagehide', () => this.invalidate());
                this.lifecycleReady = typeof root.addEventListener === 'function'
                    && typeof root.document?.addEventListener === 'function';
            } catch (_) { /* Missing lifecycle hooks make prepare ineligible. */ }
        }
        invalidate() {
            if (this.active) this.active.valid = false;
            this.active = null;
        }
        prepare(baseUrl, isPdf) {
            let ticket = null;
            try {
                const r = this.root;
                const frontend = r.document?.querySelector('meta[name="reader-preview-head"]')?.content;
                if (baseUrl !== STAGING || r.ATLAS_S0_READER_PREVIEW !== true
                    || !/\/preview\/pr-\d+(?:\/|$)/.test(r.location?.pathname || '')
                    || !SHA.test(frontend || '') || !this.lifecycleReady) return null;
                ticket = { tracked: true, finished: false, valid: false };
                this.pending++;
                if (this.pending !== 1 || !isPdf || r.document?.visibilityState !== 'visible') {
                    this.invalidate(); return ticket;
                }
                const random = r.crypto.getRandomValues(new Uint8Array(16));
                const id = 'upr_' + Array.from(random, b => b.toString(16).padStart(2, '0')).join('');
                this.active = Object.assign(ticket, { id, frontend, clock: r.performance, started: null, valid: true,
                    documentRef: null, backend: null, open: null });
                return this.active;
            } catch (_) { this.invalidate(); return ticket; }
        }
        headers(op) {
            return op && this.active === op ? { 'X-Atlas-S0-Upload': op.id, 'X-Atlas-S0-Upload-Frontend': op.frontend } : {};
        }
        start(op) {
            try {
                if (!op || this.active !== op || !op.valid || op.started !== null) return;
                op.started = op.clock.now();
                if (!Number.isFinite(op.started)) this.invalidate();
            } catch (_) { this.invalidate(); }
        }
        acknowledge(op, response, documentRef) {
            try {
                if (!op || this.active !== op) return;
                const backend = response?.headers?.get('X-Atlas-S0-Upload-Revision');
                if (!response?.ok || response.headers.get('X-Atlas-S0-Upload-Accepted') !== op.id
                    || !SHA.test(backend || '') || typeof documentRef !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(documentRef)) {
                    this.invalidate(); return;
                }
                op.documentRef = documentRef;
                op.backend = backend;
            } catch (_) { this.invalidate(); }
        }
        selection(op, documentRef) {
            if (this.active && (this.active !== op || op.documentRef !== String(documentRef))) this.invalidate();
        }
        bind(op, reader, documentRef) {
            try {
                this.selection(op, documentRef);
                if (!op || this.active !== op || !reader || op.open !== null || !op.backend) return;
                op.open = reader.id;
                reader.upload = op;
            } catch (_) { this.invalidate(); }
        }
        finish(op, reader, body, stopped) {
            try {
                if (!op || this.active !== op) return;
                this.active = null;
                if (!op.valid || op.clock !== this.root.performance || reader.clock !== op.clock
                    || this.root.document.visibilityState !== 'visible' || op.started === null
                    || op.open !== reader.id || op.documentRef !== reader.documentRef
                    || op.frontend !== body.frontend_revision || op.backend !== body.backend_revision
                    || body.mode !== 'first_open' || body.request_count !== 3) return;
                const seconds = (stopped - op.started) / 1000;
                if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) return;
                const payload = { protocol_version: 's0_upload_reader_v1',
                    measurement_scope: 'canonical_single_upload_to_initial_semantic_render_v1',
                    measurement_method: 'browser_same_context_elapsed_v1', upload_scope_id: op.id,
                    open_scope_id: reader.id, candidate_id: body.candidate_id,
                    frontend_revision: op.frontend, backend_revision: op.backend,
                    duration_seconds: Math.round(seconds * 1e6) / 1e6 };
                Promise.resolve(this.root.fetch(`${STAGING}/api/reader/v2/documents/${encodeURIComponent(op.documentRef)}/s0-upload-ready`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
                })).catch(() => {});
            } catch (_) { /* Observation failure never changes Reader outcomes. */ }
        }
        end(op) {
            if (op?.tracked && !op.finished) { op.finished = true; this.pending--; }
            if (op && this.active === op) this.invalidate();
        }
    }
    return { UploadReaderTelemetry, STAGING };
});
