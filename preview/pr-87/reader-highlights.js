(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.ReaderHighlightsV2 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const STORE_VERSION = 1;
    const KEY_PREFIX = 'reader-v2-highlights:';
    const STYLES = Object.freeze(['yellow', 'green', 'blue']);

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

    function normalizeStyle(style) {
        const value = String(style || 'yellow').trim().toLowerCase();
        return STYLES.includes(value) ? value : 'yellow';
    }

    function normalizeRecord(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        if (Number(value.version) !== STORE_VERSION) return null;
        const highlightId = String(value.highlight_id || '').trim();
        const documentRef = String(value.document_ref || '').trim();
        const candidateId = String(value.candidate_id || '').trim();
        const contractVersion = String(value.contract_version || '').trim();
        const candidateSchemaId = String(value.candidate_schema_id || '').trim();
        const candidateSchemaVersion = Number(value.candidate_schema_version);
        const nodeId = String(value.node_id || '').trim();
        const textStart = Number(value.text_start);
        const textEnd = Number(value.text_end);
        if (!highlightId || !documentRef || !candidateId || contractVersion !== '2' || !candidateSchemaId || candidateSchemaVersion !== 2 || !nodeId) return null;
        if (!Number.isInteger(textStart) || !Number.isInteger(textEnd) || textStart < 0 || textEnd <= textStart) return null;
        const createdAt = Number(value.created_at);
        const updatedAt = Number(value.updated_at);
        return {
            version: STORE_VERSION,
            highlight_id: highlightId,
            document_ref: documentRef,
            candidate_id: candidateId,
            contract_version: contractVersion,
            candidate_schema_id: candidateSchemaId,
            candidate_schema_version: candidateSchemaVersion,
            node_id: nodeId,
            source_unit_id: value.source_unit_id ? String(value.source_unit_id) : null,
            source_anchor: cloneAnchor(value.source_anchor),
            text_start: textStart,
            text_end: textEnd,
            style: normalizeStyle(value.style),
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

    function defaultIdFactory(documentView, location, textStart, textEnd, now) {
        const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2, 10);
        return `highlight:${documentView.candidate_id}:${location.node_id}:${textStart}:${textEnd}:${now}:${random}`;
    }

    function recordForRange(documentView, location, textStart, textEnd, options = {}) {
        if (!documentView || !location?.node_id) return null;
        const now = Number(options.now || Date.now());
        const idFactory = options.idFactory || defaultIdFactory;
        return normalizeRecord({
            version: STORE_VERSION,
            highlight_id: options.highlightId || idFactory(documentView, location, textStart, textEnd, now),
            document_ref: documentView.document_ref,
            candidate_id: documentView.candidate_id,
            contract_version: documentView.contract_version,
            candidate_schema_id: documentView.candidate_schema_id,
            candidate_schema_version: documentView.candidate_schema_version,
            node_id: location.node_id,
            source_unit_id: location.source_unit_id || null,
            source_anchor: location.source_anchor || null,
            text_start: textStart,
            text_end: textEnd,
            style: options.style || 'yellow',
            created_at: Number(options.createdAt || now),
            updated_at: now,
        });
    }

    function validForText(record, textLength) {
        const value = normalizeRecord(record);
        const length = Number(textLength);
        return Boolean(value && Number.isInteger(length) && length >= 0 && value.text_end <= length);
    }

    function compareRanges(a, b) {
        return a.text_start - b.text_start
            || a.text_end - b.text_end
            || a.created_at - b.created_at
            || a.highlight_id.localeCompare(b.highlight_id);
    }

    function segmentsForRanges(textLength, records) {
        const length = Number(textLength);
        if (!Number.isInteger(length) || length < 0) return [];
        const ranges = (records || []).map(normalizeRecord).filter(Boolean)
            .filter((record) => validForText(record, length))
            .sort(compareRanges);
        const boundaries = new Set([0, length]);
        for (const record of ranges) {
            boundaries.add(record.text_start);
            boundaries.add(record.text_end);
        }
        const points = [...boundaries].sort((a, b) => a - b);
        const segments = [];
        for (let index = 0; index + 1 < points.length; index += 1) {
            const start = points[index];
            const end = points[index + 1];
            if (end <= start) continue;
            const active = ranges.filter((record) => record.text_start < end && record.text_end > start).sort(compareRanges);
            const winner = active[0] || null;
            segments.push({
                start,
                end,
                highlight_id: winner?.highlight_id || null,
                style: winner?.style || null,
            });
        }
        return segments;
    }

    class ReaderHighlightStoreV2 {
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
                return parsed.records.map(normalizeRecord).filter(Boolean)
                    .filter((record) => record.document_ref === String(documentRef))
                    .sort((a, b) => a.created_at - b.created_at || a.highlight_id.localeCompare(b.highlight_id));
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
            const index = records.findIndex((item) => item.highlight_id === normalized.highlight_id);
            if (index >= 0) records[index] = normalized;
            else records.push(normalized);
            this.writeAll(normalized.document_ref, records);
            return normalized;
        }

        remove(documentRef, highlightId) {
            const records = this.list(documentRef);
            const next = records.filter((record) => record.highlight_id !== String(highlightId || ''));
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
        STYLES,
        STORE_VERSION,
        ReaderHighlightStoreV2,
        compareRanges,
        normalizeRecord,
        recordForRange,
        sameCandidate,
        segmentsForRanges,
        storageKey,
        validForText,
    };
});