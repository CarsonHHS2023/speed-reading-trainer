const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Api = require('../reader-api.js');
const Assets = require('../reader-assets.js');
const Adapter = require('../speed-reading-adapter.js');

function response(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return body; },
    };
}

class FakeElement {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.className = '';
        this.textContent = '';
        this.src = '';
        this.alt = '';
    }
    appendChild(child) { this.children.push(child); return child; }
    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) this.children.splice(index, 1);
        return child;
    }
    get firstChild() { return this.children[0] || null; }
}

const documentObject = { createElement: (tag) => new FakeElement(tag) };

const identity = {
    contract_version: '2',
    document_ref: 'doc 1',
    candidate_id: 'cand 1',
    candidate_schema_id: 'atlas.structured-content-candidate',
    candidate_schema_version: 2,
};

test('Reader v2 asset client is candidate-bound and v2-only', async () => {
    const calls = [];
    const client = new Api.ReaderApiClientV2({
        baseUrl: 'https://example.test/',
        fetchImpl: async (url) => {
            calls.push(url);
            return response({
                ...identity,
                asset_id: 'asset/1',
                delivery_state: 'available',
                rendition_media_type: 'image/png',
            });
        },
    });
    const metadata = await client.asset('doc 1', 'asset/1', { candidateId: 'cand 1' });
    assert.equal(metadata.asset_id, 'asset/1');
    assert.match(calls[0], /\/api\/reader\/v2\/documents\/doc%201\/assets\/asset%2F1\?/);
    assert.match(calls[0], /candidate_id=cand(\+|%20)1/);
    const url = client.assetContentUrl('doc 1', 'asset/1', { candidateId: 'cand 1' });
    assert.match(url, /\/api\/reader\/v2\/documents\/doc%201\/assets\/asset%2F1\/content\?/);
    assert.match(url, /candidate_id=cand(\+|%20)1/);
    assert.doesNotMatch(url, /reader\/v1|api\/v1\/images|artifact_ref|storage_ref/);
});

test('asset resolver follows declared ref order, skips unavailable refs, and caches metadata', async () => {
    const calls = [];
    const api = {
        async asset(_doc, assetId) {
            calls.push(assetId);
            if (assetId === 'a1') return { delivery_state: 'degraded', rendition_media_type: 'image/png' };
            return { delivery_state: 'available', rendition_media_type: 'image/webp', caption: 'Second' };
        },
        assetContentUrl(_doc, assetId) { return `https://example.test/${assetId}`; },
    };
    const resolver = new Assets.ReaderAssetResolverV2({ api });
    const first = await resolver.resolveFirstAvailable('doc', 'cand', ['a1', 'a2']);
    const second = await resolver.resolveFirstAvailable('doc', 'cand', ['a1', 'a2']);
    assert.equal(first.contentUrl, 'https://example.test/a2');
    assert.equal(first.metadata.caption, 'Second');
    assert.deepEqual(calls, ['a1', 'a2']);
    assert.deepEqual(second, first);
});

test('shared renderer produces image/caption or bounded semantic placeholder', async () => {
    const target = new FakeElement('div');
    const availableResolver = {
        async resolveFirstAvailable() {
            return {
                metadata: { alt_text: 'Alt', caption: 'Caption' },
                contentUrl: 'https://example.test/content',
            };
        },
    };
    await Assets.renderAssetInto({
        documentObject,
        resolver: availableResolver,
        documentRef: 'doc', candidateId: 'cand', assetRefs: ['a'], nodeType: 'figure', target,
    });
    assert.equal(target.children[0].tagName, 'FIGURE');
    assert.equal(target.children[0].children[0].tagName, 'IMG');
    assert.equal(target.children[0].children[0].src, 'https://example.test/content');
    assert.equal(target.children[0].children[0].alt, 'Alt');
    assert.equal(target.children[0].children[1].textContent, 'Caption');

    const fallback = new FakeElement('div');
    await Assets.renderAssetInto({
        documentObject,
        resolver: { async resolveFirstAvailable() { return null; } },
        documentRef: 'doc', candidateId: 'cand', assetRefs: [], nodeType: 'table', fallbackText: 'Table 1', target: fallback,
    });
    assert.equal(fallback.children[0].className, 'reader-v2-placeholder');
    assert.equal(fallback.children[0].textContent, 'Table 1');
});

test('manual playback frames carry asset refs without changing stable frame identity', () => {
    const node = {
        node_id: 'fig-1', order: 0, node_type: 'figure', text: 'Figure 1', asset_refs: ['a2', 'a1'],
        source_unit_ids: ['p1'],
        location: { source_unit_id: 'p1', source_anchor: { kind: 'spatial', source_unit_id: 'p1', normalized_bbox: [0, 0, 1, 1] } },
    };
    const result = Adapter.buildPlaybackFrames(identity, [node], { displayScope: 'block', speedPerMinute: 5000 });
    assert.equal(result.frames.length, 1);
    const frame = result.frames[0];
    assert.equal(frame.kind, 'manual');
    assert.deepEqual(frame.asset_refs, ['a2', 'a1']);
    assert.equal(frame.frame_id, 'playback-frame:cand 1:fig-1:0000');
    assert.equal(frame.auto_advance, false);
    assert.equal(frame.duration_ms, null);
    assert.equal(frame.identity.node_id, 'fig-1');
    assert.equal(frame.identity.source_unit_id, 'p1');
});

test('Reader asset UI boundary contains no legacy image/content or storage-locator dependency', () => {
    const assets = fs.readFileSync('reader-assets.js', 'utf8');
    const readerUi = fs.readFileSync('reader-ui-v2.js', 'utf8');
    const playbackUi = fs.readFileSync('reader-speed-playback-ui.js', 'utf8');
    for (const forbidden of ['/api/reader/v1', '/api/v1/images/', '/api/v1/books/', 'artifact_ref', 'storage_ref', 'imageMarkerMap', 'cachedContentBlob', 'tokenizeContent(']) {
        assert.equal(assets.includes(forbidden), false, `assets contains ${forbidden}`);
        assert.equal(readerUi.includes(forbidden), false, `reader UI contains ${forbidden}`);
        assert.equal(playbackUi.includes(forbidden), false, `playback UI contains ${forbidden}`);
    }
    const html = fs.readFileSync('index.html', 'utf8');
    assert.ok(html.indexOf('reader-assets.js') < html.indexOf('reader-ui-v2.js'));
    assert.ok(html.indexOf('reader-assets.js') < html.indexOf('reader-speed-playback-ui.js'));
});
