(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderAnnotationsV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const STORE_VERSION = 1;
    const KEY_PREFIX = 'reader-v2-annotations:';
    const KINDS = new Set(['bookmark', 'note']);

    function storageKey(documentRef) {
        return `${KEY_PREFIX}${encodeURIComponent(String(documentRef || ''))}`;
    }

    function defaultStorage() {
        try {
            return typeof localStorage !== 'undefined' ? localStorage : null;
        } catch (_) {
            return null;
        }
    }

    function cloneAnchor(anchor) {
        if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) return null;
        try { return JSON.parse(JSON.stringify(anchor)); } catch (_) { return null; }
    }

    function normalizeRecord(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        if (Number(value.version) !== STORE_VERSION) return null;
        const annotationId = String(value.annotation_id || '').trim();
        const documentRef = String(value.document_ref || '').trim();
        const candidateId = String(value.candidate_id || '').trim();
        const contractVersion = String(value.contract_version || '').trim();
        const candidateSchemaId = String(value.candidate_schema_id || '').trim();
        const candidateSchemaVersion = Number(value.candidate_schema_version);
        const nodeId = String(value.node_id || '').trim();
        const kind = String(value.kind || '').trim();
        if (!annotationId || !documentRef || !candidateId || contractVersion !== '2' || !candidateSchemaId || candidateSchemaVersion !== 2 || !nodeId || !KINDS.has(kind)) return null;
        const text = kind === 'note' ? String(value.note_text || '').trim() : '';
        if (kind === 'note' && !text) return null;
        const createdAt = Number(value.created_at);
        const updatedAt = Number(value.updated_at);
        return {
            version: STORE_VERSION,
            annotation_id: annotationId,
            document_ref: documentRef,
            candidate_id: candidateId,
            contract_version: contractVersion,
            candidate_schema_id: candidateSchemaId,
            candidate_schema_version: candidateSchemaVersion,
            node_id: nodeId,
            source_unit_id: value.source_unit_id ? String(value.source_unit_id) : null,
            source_anchor: cloneAnchor(value.source_anchor),
            kind,
            note_text: text,
            created_at: Number.isFinite(createdAt) ? createdAt : 0,
            updated_at: Number.isFinite(updatedAt) ? updatedAt : 0,
        };
    }

    function sameCandidate(record, documentView) {
        const value = normalizeRecord(record);
        if (!value || !documentView) return false;
        return value.document_ref === String(documentView.document_ref || '')
            && value.candidate_id === String(documentView.candidate_id || '')
            && value.contract_version === String(documentView.contract_version || '')
            && value.candidate_schema_id === String(documentView.candidate_schema_id || '')
            && value.candidate_schema_version === Number(documentView.candidate_schema_version);
    }

    function defaultIdFactory(kind, documentView, location, now) {
        if (kind === 'bookmark') return `bookmark:${documentView.candidate_id}:${location.node_id}`;
        const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2, 10);
        return `note:${documentView.candidate_id}:${location.node_id}:${now}:${random}`;
    }

    function recordForLocation(documentView, location, options = {}) {
        if (!documentView || !location?.node_id || !KINDS.has(options.kind)) return null;
        const now = Number(options.now || Date.now());
        const idFactory = options.idFactory || defaultIdFactory;
        const annotationId = options.annotationId || idFactory(options.kind, documentView, location, now);
        return normalizeRecord({
            version: STORE_VERSION,
            annotation_id: annotationId,
            document_ref: documentView.document_ref,
            candidate_id: documentView.candidate_id,
            contract_version: documentView.contract_version,
            candidate_schema_id: documentView.candidate_schema_id,
            candidate_schema_version: documentView.candidate_schema_version,
            node_id: location.node_id,
            source_unit_id: location.source_unit_id || null,
            source_anchor: location.source_anchor || null,
            kind: options.kind,
            note_text: options.noteText || '',
            created_at: Number(options.createdAt || now),
            updated_at: now,
        });
    }

    class ReaderAnnotationStoreV2 {
        constructor(options = {}) {
            this.storage = options.storage === undefined ? defaultStorage() : options.storage;
        }

        list(documentRef) {
            if (!this.storage || !documentRef) return [];
            try {
                const raw = this.storage.getItem(storageKey(documentRef));
                if (!raw) return [];
                const parsed = JSON.parse(raw);
                if (!parsed || Number(parsed.version) !== STORE_VERSION || !Array.isArray(parsed.records)) {
                    this.clear(documentRef);
                    return [];
                }
                const records = parsed.records.map(normalizeRecord).filter(Boolean)
                    .filter((record) => record.document_ref === String(documentRef));
                return records.sort((a, b) => a.created_at - b.created_at || a.annotation_id.localeCompare(b.annotation_id));
            } catch (_) {
                this.clear(documentRef);
                return [];
            }
        }

        writeAll(documentRef, records) {
            if (!this.storage || !documentRef) return [];
            const normalized = (records || []).map(normalizeRecord).filter(Boolean)
                .filter((record) => record.document_ref === String(documentRef));
            try {
                this.storage.setItem(storageKey(documentRef), JSON.stringify({ version: STORE_VERSION, records: normalized }));
                return normalized;
            } catch (_) {
                return [];
            }
        }

        upsert(record) {
            const normalized = normalizeRecord(record);
            if (!normalized) return null;
            const records = this.list(normalized.document_ref);
            const index = records.findIndex((item) => item.annotation_id === normalized.annotation_id);
            if (index >= 0) records[index] = normalized;
            else records.push(normalized);
            this.writeAll(normalized.document_ref, records);
            return normalized;
        }

        remove(documentRef, annotationId) {
            const records = this.list(documentRef);
            const next = records.filter((record) => record.annotation_id !== String(annotationId || ''));
            this.writeAll(documentRef, next);
            return next.length !== records.length;
        }

        clear(documentRef) {
            if (!this.storage || !documentRef) return;
            try { this.storage.removeItem(storageKey(documentRef)); } catch (_) {}
        }
    }

    return {
        KEY_PREFIX,
        KINDS,
        STORE_VERSION,
        ReaderAnnotationStoreV2,
        normalizeRecord,
        recordForLocation,
        sameCandidate,
        storageKey,
    };
});