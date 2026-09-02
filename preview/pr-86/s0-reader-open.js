(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.AtlasS0ReaderOpen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const STAGING = 'https://carsonhhs-pdf-ocr-service-staging.hf.space';
    const SHA = /^[0-9a-f]{40}$/;

    class ReaderOpenTelemetry {
        constructor({ baseUrl, fetchImpl, rootObject }) {
            this.baseUrl = baseUrl;
            this.fetchImpl = fetchImpl;
            this.root = rootObject;
            this.active = null;
        }

        begin(documentRef, readResume) {
            try {
                if (this.active) {
                    this.active.valid = false;
                    this.active = null;
                    return null; // Overlapping controller opens cannot be attributed safely.
                }
                const root = this.root;
                const sha = root.document?.querySelector('meta[name="reader-preview-head"]')?.content;
                if (root.ATLAS_S0_READER_PREVIEW !== true || this.baseUrl !== STAGING
                    || !/\/preview\/pr-\d+(?:\/|$)/.test(root.location?.pathname || '') || !SHA.test(sha || '')) return null;
                const resume = readResume?.();
                // Legacy node-id recovery can scan repeatedly. It is outside this bounded-open contract.
                if (resume && (!Number.isInteger(resume.node_order) || resume.node_order < 0)) return null;
                const bytes = root.crypto.getRandomValues(new Uint8Array(16));
                const id = `reader_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
                this.active = { id, documentRef, frontendRevision: sha, started: root.performance.now(),
                    count: 0, pending: 0, valid: true, candidate: null, backendRevision: null };
                return this.active;
            } catch (_) { return null; }
        }

        request(path) {
            try {
                const op = this.active;
                if (!op?.valid) return null;
                const prefix = `/api/reader/v2/documents/${encodeURIComponent(op.documentRef)}`;
                const url = new URL(path, STAGING);
                const route = url.pathname === prefix ? 'metadata'
                    : url.pathname === `${prefix}/navigation` ? 'navigation'
                    : url.pathname === `${prefix}/content` ? 'content' : null;
                if (!route) return null; // Binary assets and unrelated operations are never counted.
                if ((route === 'content' && url.searchParams.get('limit') !== '150') || op.count >= 4) {
                    op.valid = false;
                    return null;
                }
                const ordinal = ++op.count;
                const expected = ordinal === 1 ? 'metadata' : ordinal === 2 ? 'navigation' : 'content';
                if (route !== expected) { op.valid = false; return null; }
                op.pending++;
                return { op, headers: { 'X-Atlas-S0-Open': op.id, 'X-Atlas-S0-Ordinal': String(ordinal) } };
            } catch (_) { if (this.active) this.active.valid = false; return null; }
        }

        response(ticket, response, body) {
            if (!ticket) return;
            try {
                const op = ticket.op;
                op.pending--;
                const revision = response?.headers?.get('X-Atlas-S0-Revision');
                const candidate = body?.candidate_id;
                if (!response?.ok || !SHA.test(revision || '') || typeof candidate !== 'string' || !candidate
                    || body?.document_ref !== op.documentRef || (op.candidate && op.candidate !== candidate)
                    || (op.backendRevision && op.backendRevision !== revision)) op.valid = false;
                op.candidate = candidate;
                op.backendRevision = revision;
            } catch (_) { ticket.op.valid = false; }
        }

        finish(op, { succeeded, mode, candidateId, documentRef }) {
            try {
                if (!op || this.active !== op) return;
                this.active = null;
                if (!op.valid || !succeeded || op.pending !== 0 || op.candidate !== candidateId
                    || op.documentRef !== documentRef || !['first_open', 'reopen'].includes(mode)
                    || op.count < 3 || op.count > 4 || (mode === 'first_open' && op.count !== 3)) return;
                const seconds = (this.root.performance.now() - op.started) / 1000;
                if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) return;
                const body = { open_scope_id: op.id, candidate_id: candidateId,
                    frontend_revision: op.frontendRevision, backend_revision: op.backendRevision,
                    mode, request_count: op.count, duration_seconds: Math.round(seconds * 1e6) / 1e6 };
                // Detached, no retries. Persistence failure never delays or fails Reader open.
                Promise.resolve(this.fetchImpl(`${STAGING}/api/reader/v2/documents/${encodeURIComponent(documentRef)}/s0-open`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
                })).catch(() => {});
            } catch (_) { /* Telemetry never changes Reader behavior. */ }
        }
    }
    return { ReaderOpenTelemetry, STAGING };
});
