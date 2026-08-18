const test = require('node:test');
const assert = require('node:assert/strict');

const Debug = require('../reader-node-debug-runtime.js');

function openResponse(candidateId = 'candidate-current', documentRef = 'doc') {
    return {
        document_ref: documentRef,
        candidate_id: candidateId,
        source_units: [
            { source_unit_id: 'page-1', kind: 'physical_page', source_order: 0 },
            { source_unit_id: 'page-2', kind: 'physical_page', source_order: 1 },
        ],
    };
}

function node(nodeId, sourceUnitId, order) {
    return {
        node_id: nodeId,
        node_type: 'paragraph',
        order,
        source_unit_ids: [sourceUnitId],
        source_anchors: [],
        text: nodeId,
        metadata: {},
        warnings: [],
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolveValue, rejectValue) => {
        resolve = resolveValue;
        reject = rejectValue;
    });
    return { promise, resolve, reject };
}

function controllerWithApi(api, presentation = null, options = {}) {
    const controller = new Debug.ReaderNodeDebugController({
        api,
        documentObject: null,
        model: options.model || { orderedNodes: (nodes) => [...nodes], nodeTag: () => 'p' },
        presentation: presentation || {
            presentationForDocument: (_opened, nodes) => ({
                mode: 'semantic_full_page',
                pages: [{ nodes }],
            }),
        },
        tocIntegration: options.tocIntegration || null,
    });
    controller.populatePageOptions = () => Debug.selectableSourceUnits(controller.openResponse);
    controller.clearPageDisplay = () => {};
    controller.populateFilterOptions = () => {};
    controller.renderSummary = () => {};
    controller.applyFilters = () => {};
    controller.syncUrl = () => {};
    controller.setStatus = () => {};
    return controller;
}

test('historical candidate opening does not validate current-candidate navigation as historical', async () => {
    const navigationCalls = [];
    const api = {
        open: async () => openResponse(),
        navigation: async (_documentRef, options) => {
            navigationCalls.push(options);
            return { navigation: [{ node_id: 'current-heading' }] };
        },
    };
    const controller = controllerWithApi(api);

    const pages = await controller.openDocument('doc', 'candidate-historical');

    assert.equal(controller.candidateId, 'candidate-historical');
    assert.deepEqual(controller.navigation, []);
    assert.equal(navigationCalls.length, 0);
    assert.deepEqual(pages.map((unit) => unit.source_unit_id), ['page-1', 'page-2']);
});

test('current candidate opening still loads candidate-validated navigation', async () => {
    const navigationCalls = [];
    const api = {
        open: async () => openResponse(),
        navigation: async (_documentRef, options) => {
            navigationCalls.push(options);
            return { navigation: [{ node_id: 'current-heading' }] };
        },
    };
    const controller = controllerWithApi(api);

    await controller.openDocument('doc', 'candidate-current');

    assert.deepEqual(navigationCalls, [{ candidateId: 'candidate-current' }]);
    assert.deepEqual(controller.navigation, [{ node_id: 'current-heading' }]);
});

test('a stale page load cannot replace the latest selected page diagnostics', async () => {
    const first = deferred();
    const second = deferred();
    const calls = [];
    const api = {
        fetchImpl: null,
        content: async () => {
            const request = calls.length === 0 ? first : second;
            calls.push(request);
            return request.promise;
        },
    };
    const controller = controllerWithApi(api);
    controller.documentRef = 'doc';
    controller.candidateId = 'candidate-current';
    controller.openResponse = openResponse();

    const pageOneLoad = controller.loadSelectedPage('page-1');
    await Promise.resolve();
    const pageTwoLoad = controller.loadSelectedPage('page-2');
    await Promise.resolve();

    second.resolve({
        nodes: [node('page-two-node', 'page-2', 2)],
        has_more: false,
        next_node_order: null,
    });
    await pageTwoLoad;

    first.resolve({
        nodes: [node('page-one-node', 'page-1', 1)],
        has_more: false,
        next_node_order: null,
    });
    await pageOneLoad;

    assert.equal(controller.selectedSourceUnitId, 'page-2');
    assert.deepEqual(controller.rawNodes.map((item) => item.node_id), ['page-two-node']);
    assert.deepEqual(controller.records.map((item) => item.node_id), ['page-two-node']);
    assert.equal(controller.scanStats.selected_node_count, 1);
});

test('an error from a stale page load is ignored after a newer page is selected', async () => {
    const first = deferred();
    const second = deferred();
    const calls = [];
    const api = {
        fetchImpl: null,
        content: async () => {
            const request = calls.length === 0 ? first : second;
            calls.push(request);
            return request.promise;
        },
    };
    const controller = controllerWithApi(api);
    controller.documentRef = 'doc';
    controller.candidateId = 'candidate-current';
    controller.openResponse = openResponse();

    const pageOneLoad = controller.loadSelectedPage('page-1');
    await Promise.resolve();
    const pageTwoLoad = controller.loadSelectedPage('page-2');
    await Promise.resolve();

    second.resolve({
        nodes: [node('page-two-node', 'page-2', 2)],
        has_more: false,
        next_node_order: null,
    });
    await pageTwoLoad;
    first.reject(new Error('stale request failed'));

    await assert.doesNotReject(pageOneLoad);
    assert.equal(controller.selectedSourceUnitId, 'page-2');
    assert.deepEqual(controller.rawNodes.map((item) => item.node_id), ['page-two-node']);
});

test('cross-page presentation matching prefers the selected source-unit occurrence', () => {
    const shared = node('cross-page-node', 'page-1', 1);
    const presentation = {
        mode: 'semantic_full_page',
        pages: [
            {
                presentation_id: 'presentation-page-1',
                kind: 'semantic_full_page',
                presentation_order: 0,
                source_unit_id: 'page-1',
                source_order: 0,
                nodes: [shared],
            },
            {
                presentation_id: 'presentation-page-2',
                kind: 'semantic_full_page',
                presentation_order: 1,
                source_unit_id: 'page-2',
                source_order: 1,
                nodes: [shared],
            },
        ],
    };

    const selected = Debug.presentationForNode(presentation, shared.node_id, 'page-2');

    assert.equal(selected.presentation_id, 'presentation-page-2');
    assert.equal(selected.source_unit_id, 'page-2');
});

test('a superseded document-open failure is ignored', async () => {
    const first = deferred();
    const second = deferred();
    const api = {
        open: (documentRef) => (documentRef === 'doc-a' ? first.promise : second.promise),
        navigation: async () => ({ navigation: [] }),
    };
    const controller = controllerWithApi(api);

    const oldOpen = controller.openDocument('doc-a');
    await Promise.resolve();
    const currentOpen = controller.openDocument('doc-b');
    second.resolve(openResponse('candidate-b', 'doc-b'));
    await currentOpen;

    first.reject(new Error('old document failed'));
    await assert.doesNotReject(oldOpen);

    assert.equal(controller.documentRef, 'doc-b');
    assert.equal(controller.candidateId, 'candidate-b');
});

test('a stale scan stops before requesting another chunk from a newly opened document', async () => {
    const oldChunk = deferred();
    const contentCalls = [];
    const api = {
        fetchImpl: null,
        content: async (documentRef, options) => {
            contentCalls.push({ documentRef, options });
            if (contentCalls.length > 1) throw new Error('stale scan requested another chunk');
            return oldChunk.promise;
        },
        open: async (documentRef) => openResponse('candidate-new', documentRef),
        navigation: async () => ({ navigation: [] }),
    };
    const controller = controllerWithApi(api);
    controller.documentRef = 'doc-old';
    controller.candidateId = 'candidate-old';
    controller.openResponse = openResponse('candidate-old', 'doc-old');

    const staleScan = controller.loadSelectedPage('page-1');
    await Promise.resolve();
    await controller.openDocument('doc-new');

    oldChunk.resolve({
        nodes: [node('old-node', 'page-1', 1)],
        has_more: true,
        next_node_order: 2,
    });
    await assert.doesNotReject(staleScan);

    assert.equal(contentCalls.length, 1);
    assert.equal(contentCalls[0].documentRef, 'doc-old');
    assert.equal(contentCalls[0].options.candidateId, 'candidate-old');
    assert.equal(controller.documentRef, 'doc-new');
    assert.equal(controller.candidateId, 'candidate-new');
});

test('diagnostic serialization preserves repeated node aliases and only marks true cycles', () => {
    const shared = node('shared-node', 'page-1', 1);
    const cycle = { label: 'cycle' };
    cycle.self = cycle;

    const serialized = Debug.safeJson({
        raw_nodes: [shared],
        visible_nodes: [shared],
        derived_records: [{ raw_node: shared }],
        cycle,
    });
    const parsed = JSON.parse(serialized);

    assert.equal(parsed.raw_nodes[0].node_id, 'shared-node');
    assert.equal(parsed.visible_nodes[0].node_id, 'shared-node');
    assert.equal(parsed.derived_records[0].raw_node.node_id, 'shared-node');
    assert.equal(parsed.cycle.self, '[Circular]');
});

test('opening a new document clears old diagnostics and page choices before the request settles', async () => {
    const pending = deferred();
    const api = {
        open: async () => pending.promise,
        navigation: async () => ({ navigation: [] }),
    };
    const controller = controllerWithApi(api);
    controller.documentRef = 'doc-old';
    controller.candidateId = 'candidate-old';
    controller.openResponse = openResponse('candidate-old', 'doc-old');
    controller.selectedSourceUnitId = 'page-2';
    controller.rawNodes = [node('old-node', 'page-2', 2)];
    controller.records = [{ node_id: 'old-node' }];

    let pageOptionsCleared = 0;
    let displayCleared = 0;
    controller.populatePageOptions = () => {
        pageOptionsCleared += 1;
        return [];
    };
    controller.clearPageDisplay = () => {
        displayCleared += 1;
    };

    const opening = controller.openDocument('doc-new');
    await Promise.resolve();

    assert.equal(pageOptionsCleared, 1);
    assert.equal(displayCleared, 1);
    assert.equal(controller.documentRef, 'doc-new');
    assert.equal(controller.openResponse, null);
    assert.equal(controller.selectedSourceUnitId, null);
    assert.deepEqual(controller.rawNodes, []);
    assert.deepEqual(controller.records, []);

    pending.reject(new Error('new document failed'));
    await assert.rejects(opening, /new document failed/);
    assert.equal(controller.openResponse, null);
    assert.deepEqual(controller.records, []);
});

test('loading a new page clears prior diagnostics before the request settles or fails', async () => {
    const pending = deferred();
    const api = {
        content: async () => pending.promise,
    };
    const controller = controllerWithApi(api);
    controller.documentRef = 'doc';
    controller.candidateId = 'candidate-current';
    controller.openResponse = openResponse();
    controller.selectedSourceUnitId = 'page-1';
    controller.rawNodes = [node('old-node', 'page-1', 1)];
    controller.records = [{ node_id: 'old-node' }];

    let displayCleared = 0;
    controller.clearPageDisplay = () => {
        displayCleared += 1;
    };

    const loading = controller.loadSelectedPage('page-2');
    await Promise.resolve();

    assert.equal(displayCleared, 1);
    assert.equal(controller.selectedSourceUnitId, 'page-2');
    assert.deepEqual(controller.rawNodes, []);
    assert.deepEqual(controller.records, []);

    pending.reject(new Error('new page failed'));
    await assert.rejects(loading, /new page failed/);
    assert.equal(controller.selectedSourceUnitId, 'page-2');
    assert.deepEqual(controller.records, []);
});

test('TOC layout decisions are derived only from frontend-visible nodes', async () => {
    const suppressed = node('suppressed-toc', 'page-1', 1);
    suppressed.metadata = {
        recovery_rule: 'mineru_popo_toc_item',
        suppressed_as_artifact: true,
    };
    const visible = node('visible-toc', 'page-1', 2);
    visible.metadata = { recovery_rule: 'mineru_popo_toc_item' };

    const layoutInputs = [];
    const tocIntegration = {
        tocLayout(page) {
            layoutInputs.push(page.nodes.map((item) => item.node_id));
            return {
                decisionByNodeId: new Map([
                    [visible.node_id, {
                        coordinateIndentPercent: 12,
                        legacyTextIndentPercent: null,
                        legacyTextMatched: false,
                        indentPercent: 12,
                        source: 'coordinate_fallback',
                    }],
                ]),
            };
        },
    };
    const model = {
        orderedNodes: (nodes) => nodes.filter((item) => item.metadata?.suppressed_as_artifact !== true),
        nodeTag: () => 'p',
    };
    const api = {
        content: async () => ({
            nodes: [suppressed, visible],
            has_more: false,
            next_node_order: null,
        }),
    };
    const controller = controllerWithApi(api, null, { model, tocIntegration });
    controller.documentRef = 'doc';
    controller.candidateId = 'candidate-current';
    controller.openResponse = openResponse();

    await controller.loadSelectedPage('page-1');

    assert.deepEqual(layoutInputs, [['visible-toc']]);
    assert.deepEqual(controller.rawNodes.map((item) => item.node_id), [
        'suppressed-toc',
        'visible-toc',
    ]);
    assert.deepEqual(controller.visibleNodes.map((item) => item.node_id), ['visible-toc']);
    const visibleRecord = controller.records.find((record) => record.node_id === 'visible-toc');
    const suppressedRecord = controller.records.find((record) => record.node_id === 'suppressed-toc');
    assert.equal(visibleRecord.toc_debug.final_frontend_indent_percent, 12);
    assert.equal(visibleRecord.toc_debug.final_frontend_indent_source, 'coordinate_fallback');
    assert.equal(suppressedRecord.suppressed, true);
});
