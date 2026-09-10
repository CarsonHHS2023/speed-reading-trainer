'use strict';

function sourceUnit(id, order, kind) {
    return { source_unit_id: id, source_order: order, kind };
}

function node(id, order, type, text, sourceUnitId, extra = {}) {
    return {
        node_id: id,
        order,
        node_type: type,
        text,
        asset_refs: extra.asset_refs || [],
        source_unit_ids: [sourceUnitId],
        location: {
            contract_version: '2',
            document_ref: extra.document_ref || '',
            candidate_id: extra.candidate_id || '',
            candidate_schema_id: 'atlas.structured-content-v2',
            candidate_schema_version: 2,
            node_id: id,
            source_unit_id: sourceUnitId,
            source_anchor: extra.source_anchor || {
                kind: 'text_span',
                start: order * 100,
                end: order * 100 + String(text || '').length,
            },
        },
    };
}

function documentView(documentRef, candidateId, sourceUnits) {
    return {
        contract_version: '2',
        document_ref: documentRef,
        candidate_id: candidateId,
        candidate_schema_id: 'atlas.structured-content-v2',
        candidate_schema_version: 2,
        source_units: sourceUnits,
    };
}

const pdfDocument = documentView('acceptance-pdf', 'candidate-pdf-v1', [
    sourceUnit('pdf-page-1', 0, 'physical_page'),
    sourceUnit('pdf-page-2', 1, 'physical_page'),
]);

const pdfNodes = [
    node('pdf-heading-1', 0, 'heading', '第一章 Mixed Language Reading', 'pdf-page-1'),
    node('pdf-paragraph-1', 1, 'paragraph', '中文 alpha beta 12.5% gamma，继续阅读。', 'pdf-page-1'),
    node('pdf-figure-1', 2, 'figure', 'Figure 1 · comprehension chart', 'pdf-page-1', {
        asset_refs: [{ asset_id: 'asset-figure-1' }],
    }),
    node('pdf-paragraph-2', 3, 'paragraph', 'After the figure，第二页继续。', 'pdf-page-2'),
    node('pdf-formula-1', 4, 'formula', 'E = mc²', 'pdf-page-2'),
    node('pdf-paragraph-3', 5, 'paragraph', 'Final paragraph 2026-07-27.', 'pdf-page-2'),
];

const txtDocument = documentView('acceptance-txt', 'candidate-txt-v1', [
    sourceUnit('txt-flow-1', 0, 'text_flow'),
]);

const txtNodes = [
    node('txt-heading-1', 0, 'heading', '快速阅读 Mixed-language test', 'txt-flow-1'),
    node('txt-paragraph-1', 1, 'paragraph', "中文 alpha beta state-of-the-art 12.5%，不要 split English words。", 'txt-flow-1'),
    node('txt-paragraph-2', 2, 'paragraph', 'Email test@example.com，时间 14:30，日期 2026-07-27。', 'txt-flow-1'),
    node('txt-paragraph-3', 3, 'paragraph', '最后一段 gamma delta epsilon，完成。', 'txt-flow-1'),
];

module.exports = {
    documentView,
    node,
    sourceUnit,
    pdfDocument,
    pdfNodes,
    txtDocument,
    txtNodes,
};
