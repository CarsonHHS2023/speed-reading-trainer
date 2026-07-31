const test = require('node:test');
const assert = require('node:assert/strict');

const Debug = require('../reader-node-debug.js');

const Model = {
    nodeTag(node) {
        if (node.node_type === 'heading') return `h${node.heading_level || 2}`;
        if (node.node_type === 'list_item') return 'li';
        return 'p';
    },
};

function openResponse() {
    return {
        source_units: [
            { source_unit_id: 'page-1', kind: 'physical_page', source_order: 0, dimensions: { width: 600, height: 800 } },
            { source_unit_id: 'page-2', kind: 'physical_page', source_order: 1, dimensions: { width: 600, height: 800 } },
        ],
    };
}

function node(overrides = {}) {
    return {
        node_id: 'node-1',
        node_type: 'paragraph',
        order: 1,
        content_state: 'ready',
        source_unit_ids: ['page-1'],
        source_anchors: [{ kind: 'spatial', source_unit_id: 'page-1', normalized_bbox: [0.1, 0.2, 0.8, 0.3] }],
        text: '正文',
        heading_level: null,
        parent_ref: null,
        child_refs: [],
        asset_refs: [],
        warnings: [],
        metadata: {},
        ...overrides,
    };
}

function fakeTocIntegration() {
    return {
        tocLayout(page) {
            const decisions = new Map();
            for (const item of page.nodes.filter((value) => value.metadata?.recovery_rule === 'mineru_popo_toc_item')) {
                const metadata = item.metadata || {};
                if (metadata.toc_level != null) {
                    decisions.set(item.node_id, {
                        indentPercent: metadata.toc_level === 1 ? 0 : 5,
                        source: 'metadata.toc_level',
                        tocLevel: metadata.toc_level,
                        coordinateIndentPercent: 8,
                        legacyTextIndentPercent: 0,
                        legacyTextMatched: false,
                    });
                } else {
                    decisions.set(item.node_id, {
                        indentPercent: 5,
                        source: 'legacy_text_pattern',
                        tocLevel: null,
                        coordinateIndentPercent: null,
                        legacyTextIndentPercent: 5,
                        legacyTextMatched: true,
                    });
                }
            }
            return { decisionByNodeId: decisions };
        },
    };
}

test('recognizes both supported artifact suppression markers', () => {
    assert.equal(Debug.isSuppressedNode(node({ metadata: { suppressed_as_artifact: true } })), true);
    assert.equal(Debug.isSuppressedNode(node({ metadata: { suppressed_original_kind: 'paragraph' } })), true);
    assert.equal(Debug.isSuppressedNode(node()), false);
});

test('extracts the real llm_structure_refinement audit field', () => {
    const source = node({
        metadata: {
            llm_structure_refinement: [
                {
                    model_id: 'gpt-5.6',
                    prompt_version: 'pdf_structure_refinement_v2',
                    operation: 'set_toc_level',
                    confidence: 0.95,
                    reason_codes: ['toc_hierarchy'],
                    applied: true,
                },
                {
                    model_id: 'gpt-5.6',
                    prompt_version: 'pdf_structure_refinement_v2',
                    operation: 'suppress_as_artifact',
                    confidence: 0.82,
                    reason_codes: ['possible_show_through'],
                    applied: false,
                },
            ],
        },
    });

    const entries = Debug.llmAuditEntries(source);
    const summary = Debug.llmAuditSummary(entries);

    assert.equal(entries.length, 2);
    assert.equal(summary.has_audit, true);
    assert.equal(summary.applied_count, 1);
    assert.equal(summary.rejected_count, 1);
    assert.deepEqual(summary.operation_counts, {
        set_toc_level: 1,
        suppress_as_artifact: 1,
    });
    assert.deepEqual(summary.model_ids, ['gpt-5.6']);
});

test('builds raw, LLM, TOC and frontend diagnostics without dropping suppressed nodes', () => {
    const raw = [
        node({
            node_id: 'toc-llm',
            node_type: 'list_item',
            text: '第一章……1',
            metadata: {
                recovery_rule: 'mineru_popo_toc_item',
                toc_level: 1,
                toc_level_confidence: 0.96,
                toc_level_source: 'llm_structure_refinement',
                llm_structure_refinement: [{ operation: 'set_toc_level', applied: true, confidence: 0.96 }],
            },
        }),
        node({
            node_id: 'toc-regex',
            order: 2,
            node_type: 'list_item',
            text: '一、趋势交易法流程……2',
            metadata: { recovery_rule: 'mineru_popo_toc_item' },
        }),
        node({
            node_id: 'bleed',
            order: 3,
            text: '背透文字',
            metadata: { suppressed_as_artifact: true, recovery_rule: 'show_through' },
        }),
    ];
    const presentation = {
        mode: 'semantic_full_page',
        pages: [{ presentation_id: 'page:p1', kind: 'semantic_full_page', source_unit_id: 'page-1', nodes: raw.slice(0, 2) }],
    };
    const records = Debug.buildDebugRecords(raw, openResponse(), presentation, {
        Model,
        TocIntegration: fakeTocIntegration(),
    });

    assert.equal(records.length, 3);
    assert.equal(records[0].frontend_tag, 'li');
    assert.equal(records[0].llm_refinement.has_audit, true);
    assert.equal(records[0].llm_refinement.operation_counts.set_toc_level, 1);
    assert.equal(records[0].toc_debug.metadata_toc_level_source, 'llm_structure_refinement');
    assert.equal(records[0].toc_debug.final_frontend_indent_source, 'metadata.toc_level');
    assert.equal(records[1].llm_refinement.has_audit, false);
    assert.equal(records[1].toc_debug.final_frontend_indent_source, 'legacy_text_pattern');
    assert.equal(records[2].suppressed, true);
    assert.equal(records[2].frontend_visible, false);
});

test('filters by LLM audit status, operation and TOC source', () => {
    const records = Debug.buildDebugRecords([
        node({
            node_id: 'a',
            node_type: 'list_item',
            metadata: {
                recovery_rule: 'mineru_popo_toc_item',
                toc_level: 2,
                llm_structure_refinement: [{ operation: 'set_toc_level', applied: true }],
            },
        }),
        node({
            node_id: 'b',
            order: 2,
            metadata: {
                llm_structure_refinement: [{ operation: 'suppress_as_artifact', applied: false }],
            },
        }),
        node({ node_id: 'c', order: 3 }),
    ], openResponse(), { pages: [] }, { Model, TocIntegration: fakeTocIntegration() });

    assert.deepEqual(Debug.filterRecords(records, { llmAudit: 'with_audit' }).map((item) => item.node_id), ['a', 'b']);
    assert.deepEqual(Debug.filterRecords(records, { llmAudit: 'no_audit' }).map((item) => item.node_id), ['c']);
    assert.deepEqual(Debug.filterRecords(records, { llmAudit: 'applied' }).map((item) => item.node_id), ['a']);
    assert.deepEqual(Debug.filterRecords(records, { llmAudit: 'rejected' }).map((item) => item.node_id), ['b']);
    assert.deepEqual(Debug.filterRecords(records, { llmAudit: 'operation:set_toc_level' }).map((item) => item.node_id), ['a']);
    assert.deepEqual(Debug.filterRecords(records, { tocIndentSource: 'metadata.toc_level' }).map((item) => item.node_id), ['a']);
});

test('summary reports LLM operation and TOC source counts', () => {
    const records = Debug.buildDebugRecords([
        node({
            node_id: 'a',
            node_type: 'list_item',
            metadata: {
                recovery_rule: 'mineru_popo_toc_item',
                toc_level: 1,
                llm_structure_refinement: [{ operation: 'set_toc_level', applied: true }],
            },
        }),
        node({
            node_id: 'b',
            order: 2,
            metadata: {
                llm_structure_refinement: [{ operation: 'suppress_as_artifact', applied: false }],
            },
        }),
        node({ node_id: 'c', order: 3, metadata: { suppressed_as_artifact: true } }),
    ], openResponse(), { pages: [] }, { Model, TocIntegration: fakeTocIntegration() });
    const summary = Debug.summarizeRecords(records);

    assert.equal(summary.raw_node_count, 3);
    assert.equal(summary.frontend_visible_count, 2);
    assert.equal(summary.suppressed_count, 1);
    assert.equal(summary.llm_audit_node_count, 2);
    assert.equal(summary.llm_applied_node_count, 1);
    assert.equal(summary.llm_rejected_node_count, 1);
    assert.equal(summary.llm_entry_count, 2);
    assert.equal(summary.llm_operation_counts.set_toc_level, 1);
    assert.equal(summary.llm_operation_counts.suppress_as_artifact, 1);
    assert.equal(summary.toc_indent_source_counts['metadata.toc_level'], 1);
});

test('debug bundle exports raw nodes and derived LLM diagnostics', () => {
    const records = Debug.buildDebugRecords([
        node({
            metadata: {
                llm_structure_refinement: [{ operation: 'reclassify_node', applied: true }],
            },
        }),
    ], openResponse(), { pages: [] }, { Model, TocIntegration: fakeTocIntegration() });
    const bundle = Debug.buildDebugBundle({
        documentRef: 'doc',
        candidateId: 'candidate',
        rawNodes: [records[0].raw_node],
        visibleNodes: [records[0].raw_node],
        records,
    });

    assert.equal(bundle.diagnostic_version, 'reader_node_debug_v2');
    assert.equal(bundle.raw_nodes.length, 1);
    assert.equal(bundle.derived_records[0].llm_refinement.has_audit, true);
    assert.equal(bundle.summary.llm_operation_counts.reclassify_node, 1);
});
