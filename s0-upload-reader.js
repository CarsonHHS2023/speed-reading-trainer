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
            this.lastDiagnostic = null;
            this.lifecycleReady = false;
            try {
                root.document?.addEventListener('visibilitychange', () => {
                    if (root.document.visibilityState !== 'visible') this.invalidate('page_hidden');
                });
                root.document?.addEventListener('freeze', () => this.invalidate('page_frozen'));
                root.addEventListener?.('pagehide', () => this.invalidate('page_left'));
                this.lifecycleReady = typeof root.addEventListener === 'function'
                    && typeof root.document?.addEventListener === 'function';
            } catch (_) { /* Missing lifecycle hooks make prepare ineligible. */ }
        }
        record(trace, step, httpStatus = null) {
            if (!trace || trace.steps.length >= 16) return;
            trace.steps.push({ step, http_status: Number.isInteger(httpStatus)
                && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null });
        }
        diagnostics() {
            // In-memory only. Never retain IDs, files, response bodies, headers,
            // exception text, URLs or tokens. Return a detached snapshot.
            return this.lastDiagnostic ? JSON.parse(JSON.stringify(this.lastDiagnostic)) : null;
        }
        invalidate(reason = 'observer_exception') {
            if (this.active) {
                this.active.valid = false;
                this.record(this.active.trace, reason);
            }
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
                const trace = { version: 's0_upload_reader_diagnostic_v1', frontend_revision: frontend, steps: [] };
                this.lastDiagnostic = trace;
                ticket = { tracked: true, finished: false, valid: false, trace };
                this.pending++;
                if (this.pending !== 1 || !isPdf || r.document?.visibilityState !== 'visible') {
                    const reason = this.pending !== 1 ? 'overlapping_uploads' : !isPdf ? 'batch_or_non_pdf' : 'page_hidden';
                    this.invalidate(reason); this.record(trace, reason); return ticket;
                }
                const random = r.crypto.getRandomValues(new Uint8Array(16));
                const id = 'upr_' + Array.from(random, b => b.toString(16).padStart(2, '0')).join('');
                this.active = Object.assign(ticket, { id, frontend, clock: r.performance, started: null, valid: true,
                    documentRef: null, backend: null, open: null });
                this.record(trace, 'prepared');
                return this.active;
            } catch (_) { this.invalidate(); this.record(ticket?.trace, 'prepare_exception'); return ticket; }
        }
        headers(op) {
            return op && this.active === op ? { 'X-Atlas-S0-Upload': op.id, 'X-Atlas-S0-Upload-Frontend': op.frontend } : {};
        }
        start(op) {
            try {
                if (!op || this.active !== op || !op.valid || op.started !== null) return;
                op.started = op.clock.now();
                if (!Number.isFinite(op.started)) this.invalidate('invalid_start_clock');
                else this.record(op.trace, 'upload_started');
            } catch (_) { this.invalidate('start_exception'); }
        }
        acknowledge(op, response, documentRef) {
            try {
                if (!op || this.active !== op) return;
                const backend = response?.headers?.get('X-Atlas-S0-Upload-Revision');
                const accepted = response?.headers?.get('X-Atlas-S0-Upload-Accepted');
                const reason = !response?.ok ? 'upload_response_not_ok'
                    : !accepted ? 'acceptance_header_missing'
                    : accepted !== op.id ? 'acceptance_root_mismatch'
                    : !SHA.test(backend || '') ? 'acceptance_revision_invalid'
                    : typeof documentRef !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(documentRef)
                        ? 'acceptance_document_invalid' : null;
                if (reason) { this.invalidate(reason); return; }
                op.documentRef = documentRef;
                op.backend = backend;
                this.record(op.trace, 'upload_acknowledged');
            } catch (_) { this.invalidate('acknowledgement_exception'); }
        }
        selection(op, documentRef) {
            if (this.active && (this.active !== op || op.documentRef !== String(documentRef))) this.invalidate('selection_mismatch');
        }
        bind(op, reader, documentRef) {
            try {
                this.selection(op, documentRef);
                if (!op || this.active !== op) return;
                if (!reader || op.open !== null || !op.backend) {
                    this.record(op.trace, !reader ? 'reader_scope_unavailable' : 'reader_binding_rejected'); return;
                }
                op.open = reader.id;
                reader.upload = op;
                this.record(op.trace, 'reader_bound');
            } catch (_) { this.invalidate('binding_exception'); }
        }
        finish(op, reader, body, stopped) {
            try {
                if (!op || this.active !== op) return;
                this.active = null;
                const reason = !op.valid ? 'operation_invalid'
                    : op.clock !== this.root.performance || reader.clock !== op.clock ? 'clock_replaced'
                    : this.root.document.visibilityState !== 'visible' ? 'page_hidden'
                    : op.started === null ? 'upload_not_started'
                    : op.open !== reader.id || op.documentRef !== reader.documentRef ? 'reader_identity_mismatch'
                    : op.frontend !== body.frontend_revision || op.backend !== body.backend_revision ? 'reader_revision_mismatch'
                    : body.mode !== 'first_open' || body.request_count !== 3 ? 'reader_scope_not_first_open' : null;
                if (reason) { this.record(op.trace, reason); return; }
                const seconds = (stopped - op.started) / 1000;
                if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
                    this.record(op.trace, 'elapsed_out_of_bounds'); return;
                }
                const payload = { protocol_version: 's0_upload_reader_v1',
                    measurement_scope: 'canonical_single_upload_to_initial_semantic_render_v1',
                    measurement_method: 'browser_same_context_elapsed_v1', upload_scope_id: op.id,
                    open_scope_id: reader.id, candidate_id: body.candidate_id,
                    frontend_revision: op.frontend, backend_revision: op.backend,
                    duration_seconds: Math.round(seconds * 1e6) / 1e6 };
                const trace = op.trace;
                this.record(trace, 'terminal_dispatch_attempted');
                Promise.resolve(this.root.fetch(`${STAGING}/api/reader/v2/documents/${encodeURIComponent(op.documentRef)}/s0-upload-ready`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
                })).then(response => this.record(trace, 'terminal_http_response', response?.status),
                    () => this.record(trace, 'terminal_fetch_rejected'));
            } catch (_) { this.record(op?.trace, 'terminal_exception'); }
        }
        end(op) {
            if (op?.tracked && !op.finished) { op.finished = true; this.pending--; }
            if (op && this.active === op) this.invalidate('upload_ended_without_terminal');
        }
    }
    return { UploadReaderTelemetry, STAGING };
});
