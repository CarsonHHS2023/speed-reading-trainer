const test = require('node:test');
const assert = require('node:assert/strict');

const Assets = require('../reader-assets.js');

function fakeDocument() {
  function element(tag) {
    return {
      tagName: tag.toUpperCase(),
      className: '',
      textContent: '',
      children: [],
      appendChild(child) { this.children.push(child); return child; },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); return child; },
      get firstChild() { return this.children[0] || null; },
    };
  }
  return { createElement: element };
}

test('removes OCR diagnostics from fallback display text', () => {
  assert.equal(Assets.cleanDisplayText('label: chart bbox: [1,2,3,4] content:'), '');
  assert.equal(Assets.cleanDisplayText('上升趋势示意图1-1'), '上升趋势示意图1-1');
});

test('available image replaces placeholder and does not use OCR text as caption', async () => {
  const documentObject = fakeDocument();
  const target = documentObject.createElement('div');
  target.appendChild(documentObject.createElement('div'));
  const resolver = {
    async resolveFirstAvailable() {
      return {
        contentUrl: '/asset.png',
        metadata: {
          delivery_state: 'available',
          rendition_media_type: 'image/png',
          alt_text: '趋势图',
          caption: null,
        },
      };
    },
  };

  await Assets.renderAssetInto({
    documentObject,
    resolver,
    documentRef: 'doc',
    candidateId: 'candidate',
    assetRefs: ['asset'],
    nodeType: 'figure',
    fallbackText: 'label: chart bbox: [10, 20, 30, 40] content:',
    target,
  });

  assert.equal(target.children.length, 1);
  const figure = target.children[0];
  assert.equal(figure.className, 'reader-v2-asset');
  assert.equal(figure.children.length, 1);
  assert.equal(figure.children[0].src, '/asset.png');
  assert.equal(figure.children[0].alt, '趋势图');
});

test('missing image uses a compact generic placeholder', async () => {
  const documentObject = fakeDocument();
  const target = documentObject.createElement('div');
  const resolver = { async resolveFirstAvailable() { return null; } };

  await Assets.renderAssetInto({
    documentObject,
    resolver,
    documentRef: 'doc',
    candidateId: 'candidate',
    assetRefs: [],
    nodeType: 'figure',
    fallbackText: 'label: image bbox: [1,2,3,4] content:',
    target,
  });

  assert.equal(target.children.length, 1);
  assert.equal(target.children[0].className, 'reader-v2-placeholder');
  assert.equal(target.children[0].textContent, '图像暂不可用');
});
