const test = require('node:test');
const assert = require('node:assert/strict');

const Adapter = require('../speed-reading-adapter.js');
const Policy = require('../speed-reading-structure-policy.js');

Policy.install({ SpeedReadingAdapter: Adapter });

function node(id, type, text, order, assetRefs = []) {
  return {
    node_id: id,
    node_type: type,
    text,
    order,
    asset_refs: assetRefs,
    location: { node_id: id, source_unit_id: 'p1' },
  };
}

const documentView = {
  contract_version: '2',
  document_ref: 'doc',
  candidate_id: 'candidate',
  candidate_schema_id: 'structured-content',
  candidate_schema_version: 2,
  source_units: [{ source_unit_id: 'p1', source_order: 1, kind: 'physical_page' }],
};

test('manual image does not truncate mapped Paddle content that follows it', () => {
  const result = Adapter.buildPlaybackFrames(documentView, [
    node('before', 'text', '图片之前。', 1),
    node('image', 'image', '图一', 2, ['asset-1']),
    node('after-abstract', 'abstract', '图片之后的摘要内容。', 3),
    node('after-algorithm', 'algorithm', '步骤一，继续阅读。', 4),
  ], {
    displayScope: 'line',
    lineWidth: 20,
    maxLines: 2,
    speedPerMinute: 500,
  });

  const imageIndex = result.frames.findIndex((frame) => frame.kind === 'manual');
  assert.ok(imageIndex >= 0, 'manual image frame is present');
  assert.ok(result.frames.length > imageIndex + 1, 'frames continue after the image');
  assert.match(result.frames.slice(imageIndex + 1).map((frame) => frame.text).join('\n'), /图片之后的摘要内容/);
  assert.match(result.frames.slice(imageIndex + 1).map((frame) => frame.text).join('\n'), /步骤一/);
});
