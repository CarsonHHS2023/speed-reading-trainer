(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderResumeV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const STORE_VERSION = 1;
    const KEY_PREFIX = 'reader-v2-resume:';

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

    function normalizeAnchor(anchor) {
        if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) return null;
        try {
            return JSON.parse(JSON.stringify(anchor));
        } catch (_) {
            return null;
        }
    }

    function normalizeNodeOrder(value) {
        if (value === null || value === undefined || value === '') return null;
        const numeric = Number(value);
        return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
    }

    function normalizeRecord(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        if (Number(value.version) !== STORE_VERSION) return null;
        const documentRef = String(value.document_ref || '').trim();
        const candidateId = String(value.candidate_id || '').trim();
        const contractVersion = String(value.contract_version || '').trim();
        const candidateSchemaId = String(value.candidate_schema_id || '').trim();
        const candidateSchemaVersion = Number(value.candidate_schema_version);
        const nodeId = String(value.node_id || '').trim();
        if (!documentRef || !candidateId || contractVersion !== '2' || !candidateSchemaId || candidateSchemaVersion !== 2 || !nodeId) return null;
        return {
            version: STORE_VERSION,
            document_ref: documentRef,
            candidate_id: candidateId,
            contract_version: contractVersion,
            candidate_schema_id: candidateSchemaId,
            candidate_schema_version: candidateSchemaVersion,
            node_id: nodeId,
            node_order: normalizeNodeOrder(value.node_order),
            source_unit_id: value.source_unit_id ? String(value.source_unit_id) : null,
            source_anchor: normalizeAnchor(value.source_anchor),
            frame_id: value.frame_id ? String(value.frame_id) : null,
            frame_ordinal: Number.isInteger(value.frame_ordinal) && value.frame_ordinal >= 0 ? value.frame_ordinal : null,
            updated_at: Number.isFinite(Number(value.updated_at)) ? Number(value.updated_at) : 0,
        };
    }

    function recordForLocation(documentView, location, extra = {}) {
        if (!documentView || !location?.node_id) return null;
        return normalizeRecord({
            version: STORE_VERSION,
            document_ref: documentView.document_ref,
            candidate_id: documentView.candidate_id,
            contract_version: documentView.contract_version,
            candidate_schema_id: documentView.candidate_schema_id,
            candidate_schema_version: documentView.candidate_schema_version,
            node_id: location.node_id,
            node_order: extra.nodeOrder,
            source_unit_id: location.source_unit_id || null,
            source_anchor: location.source_anchor || null,
            frame_id: extra.frameId || null,
            frame_ordinal: Number.isInteger(extra.frameOrdinal) ? extra.frameOrdinal : null,
            updated_at: Number(extra.updatedAt || Date.now()),
        });
    }

    function sameCandidate(record, documentView) {
        const normalized = normalizeRecord(record);
        if (!normalized || !documentView) return false;
        return normalized.document_ref === String(documentView.document_ref || '')
            && normalized.candidate_id === String(documentView.candidate_id || '')
            && normalized.contract_version === String(documentView.contract_version || '')
            && normalized.candidate_schema_id === String(documentView.candidate_schema_id || '')
            && normalized.candidate_schema_version === Number(documentView.candidate_schema_version);
    }

    class ReaderResumeStoreV2 {
        constructor(options = {}) {
            this.storage = options.storage === undefined ? defaultStorage() : options.storage;
        }

        read(documentRef) {
            if (!this.storage || !documentRef) return null;
            try {
                const raw = this.storage.getItem(storageKey(documentRef));
                if (!raw) return null;
                const normalized = normalizeRecord(JSON.parse(raw));
                if (!normalized || normalized.document_ref !== String(documentRef)) {
                    this.clear(documentRef);
                    return null;
                }
                return normalized;
            } catch (_) {
                this.clear(documentRef);
                return null;
            }
        }

        write(record) {
            const normalized = normalizeRecord(record);
            if (!this.storage || !normalized) return null;
            try {
                this.storage.setItem(storageKey(normalized.document_ref), JSON.stringify(normalized));
                return normalized;
            } catch (_) {
                return null;
            }
        }

        clear(documentRef) {
            if (!this.storage || !documentRef) return;
            try { this.storage.removeItem(storageKey(documentRef)); } catch (_) {}
        }
    }

    return {
        KEY_PREFIX,
        STORE_VERSION,
        ReaderResumeStoreV2,
        normalizeNodeOrder,
        normalizeRecord,
        recordForLocation,
        sameCandidate,
        storageKey,
    };
});