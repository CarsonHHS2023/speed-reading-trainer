const test = require('node:test');
const assert = require('node:assert/strict');

const Debug = require('../reader-node-debug.js');

function openResponse(candidateId = 'candidate-current') {
    return {
        document_ref: 'doc',
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

function controllerWithApi(api) {
    const controller = new Debug.ReaderNodeDebugController({
        api,
        documentObject: null,
        model: { orderedNodes: (nodes) => [...nodes], nodeTag: () => 'p' },
        presentation: {
            presentationForDocument: (_opened, nodes) => ({
                mode: 'semantic_full_page',
                pages: [{ nodes }],
            }),
        },
        tocIntegration: null,
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
