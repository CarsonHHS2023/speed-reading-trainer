const test = require('node:test');
const assert = require('node:assert/strict');

const { PlaybackController } = require('../playback-controller.js');

function frame(frameId, primaryNodeId, sourceNodeIds = [primaryNodeId]) {
    return {
        frame_id: frameId,
        kind: 'timed_text',
        duration_ms: 1000,
        identity: { node_id: primaryNodeId },
        source_spans: sourceNodeIds.map((node_id) => ({ node_id })),
    };
}

test('Page reflow preserves the current semantic node when frame ordinals regroup', () => {
    const controller = new PlaybackController();
    controller.setFrames([
        frame('page-0000', 'p1'),
        frame('page-0001', 'p2'),
    ], { preserveIdentity: false });
    controller.seek(0.75);
    assert.equal(controller.currentFrame().identity.node_id, 'p2');

    controller.setFrames([
        frame('page-0001', 'p1'),
        frame('page-0002', 'p1', ['p1', 'p2']),
        frame('page-0003', 'p3'),
    ], { preserveIdentity: true });

    assert.equal(controller.index, 1, 'stale ordinal match must not replace semantic identity');
    assert.ok(controller.currentFrame().source_spans.some((span) => span.node_id === 'p2'));
});
