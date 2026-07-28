const test = require('node:test');
const assert = require('node:assert/strict');

const Api = require('../reader-api.js');
const Model = require('../reader-model.js');

function response(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return body; },
    };
}

test('Reader v2 identity is strict and rejects v1', () => {
    assert.equal(Api.CONTRACT_VERSION, '2');
    const valid = {
        contract_version: '2', document_ref: 'doc', candidate_id: 'cand',
        candidate_schema_id: 'atlas.structured-content-candidate', candidate_schema_version: 2,
    };
    assert.equal(Api.assertIdentity(valid), valid);
    assert.throws(() => Api.assertIdentity({ ...valid, contract_version: '1' }), /contract version/i);
});

test('Reader v2 client uses open, navigation, and node-order content routes', async () => {
    const calls = [];
    const base = {
        contract_version: '2', document_ref: 'doc 1', candidate_id: 'cand',
        candidate_schema_id: 'atlas.structured-content-candidate', candidate_schema_version: 2,
    };
    const client = new Api.ReaderApiClientV2({
        baseUrl: 'https://example.test/',
        fetchImpl: async (url) => {
            calls.push(url);
            return response(base);
        },
    });
    await client.open('doc 1');
    await client.navigation('doc 1', { candidateId: 'cand' });
    await client.content('doc 1', { candidateId: 'cand', startNodeOrder: 25, limit: 40 });
    assert.equal(calls[0], 'https://example.test/api/reader/v2/documents/doc%201');
    assert.equal(calls[1], 'https://example.test/api/reader/v2/documents/doc%201/navigation');
    assert.match(calls[2], /\/api\/reader\/v2\/documents\/doc%201\/content\?/);
    assert.match(calls[2], /start_node_order=25/);
    assert.match(calls[2], /limit=40/);
    assert.match(calls[2], /candidate_id=cand/);
    assert.doesNotMatch(calls.join('\n'), /reader\/v1|api\/v1\/books/);
});

test('bounded API errors preserve safe code/message', async () => {
    const client = new Api.ReaderApiClientV2({
        baseUrl: 'https://example.test',
        fetchImpl: async () => response({ detail: { code: 'reader_selection_changed', message: 'stale' } }, 409),
    });
    await assert.rejects(
        () => client.open('doc'),
        (error) => error instanceof Api.ReaderApiError && error.status === 409 && error.code === 'reader_selection_changed' && error.safeMessage === 'stale',
    );
});

test('source units and semantic nodes are deterministically ordered', () => {
    const units = [
        { source_unit_id: 'u2', source_order: 1, kind: 'text_flow' },
        { source_unit_id: 'u1', source_order: 0, kind: 'physical_page' },
    ];
    assert.deepEqual(Model.orderedSourceUnits(units).map((x) => x.source_unit_id), ['u1', 'u2']);
    const nodes = [{ node_id: 'n2', order: 1 }, { node_id: 'n1', order: 0 }];
    assert.deepEqual(Model.orderedNodes(nodes).map((x) => x.node_id), ['n1', 'n2']);
    assert.deepEqual(Model.mergeNodes([{ node_id: 'n1', order: 0 }], [{ node_id: 'n2', order: 1 }]).map((x) => x.node_id), ['n1', 'n2']);
});

test('Reader locations are source anchored and never page anchored', () => {
    const spatial = {
        contract_version: '2', document_ref: 'doc', candidate_id: 'cand',
        candidate_schema_id: 'atlas.structured-content-candidate', candidate_schema_version: 2,
        node_id: 'n1', source_unit_id: 'p1',
        source_anchor: { kind: 'spatial', source_unit_id: 'p1', normalized_bbox: [0.1, 0.2, 0.8, 0.9] },
    };
    const text = {
        ...spatial,
        source_unit_id: 'f1',
        source_anchor: { kind: 'text_span', source_unit_id: 'f1', start: 10, end: 25 },
    };
    assert.match(Model.locationKey(spatial), /spatial:0.1,0.2,0.8,0.9/);
    assert.match(Model.locationKey(text), /text_span:10:25/);
    assert.doesNotMatch(Model.locationKey(spatial), /page_id|page_order/);
});

test('reflowable and physical source unit helpers are derived only', () => {
    assert.equal(Model.isReflowableSourceUnit({ kind: 'text_flow' }), true);
    assert.equal(Model.isReflowableSourceUnit({ kind: 'physical_page' }), false);
    assert.deepEqual(
        Model.physicalPageSourceUnits([
            { source_unit_id: 'f1', source_order: 0, kind: 'text_flow' },
            { source_unit_id: 'p2', source_order: 2, kind: 'physical_page' },
            { source_unit_id: 'p1', source_order: 1, kind: 'physical_page' },
        ]).map((x) => x.source_unit_id),
        ['p1', 'p2'],
    );
});

test('plain text follows semantic node order', () => {
    const text = Model.toPlainText([
        { node_id: 'n2', order: 1, node_type: 'paragraph', text: 'Body' },
        { node_id: 'n1', order: 0, node_type: 'heading', text: 'Title' },
        { node_id: 'n3', order: 2, node_type: 'figure', text: 'ignored visual' },
    ]);
    assert.equal(text, 'Title\nBody');
});

test('client/model source contains no page-centric Reader v1 compatibility path', () => {
    const fs = require('node:fs');
    const apiSource = fs.readFileSync('reader-api.js', 'utf8');
    const modelSource = fs.readFileSync('reader-model.js', 'utf8');
    for (const forbidden of ['/api/reader/v1', '/api/v1/books/', 'page_id', 'page_order', 'mergePages']) {
        assert.equal(apiSource.includes(forbidden), false, `API contains ${forbidden}`);
        assert.equal(modelSource.includes(forbidden), false, `model contains ${forbidden}`);
    }
});
