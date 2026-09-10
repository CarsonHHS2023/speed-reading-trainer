const test = require('node:test');
const assert = require('node:assert/strict');

const Integrity = require('../speed-reading-layout-integrity.js');

function targetWithContainer(clientWidth) {
  const container = { style: {} };
  return {
    clientWidth,
    querySelector(selector) {
      return selector === '.reader-playback-frame-text' ? container : null;
    },
    container,
  };
}

test('moving placement recenters the measured plane in the current target instead of reusing stale build-time inset', () => {
  const target = targetWithContainer(1141);
  const controller = {
    document: { defaultView: {} },
    displayScope: () => 'line',
    readingMode: () => 'moving',
  };
  const root = {
    SpeedReadingResponsiveLayout: {
      contentBoxWidth() { return 1141; },
    },
  };
  const frame = {
    kind: 'timed_text',
    placement: {
      display_scope: 'line',
      content_width_px: 1117,
      content_origin_x_px: 24,
      x_px: 24,
      width_px: 1117,
    },
  };

  const geometry = Integrity.applyRuntimeHorizontalPlacement(controller, frame, target, root);

  assert.equal(geometry.runtime_origin_x_px, 12);
  assert.equal(geometry.internal_x_px, 0);
  assert.equal(geometry.rendered_left_px, 12);
  assert.equal(target.container.style.left, '12px');
});

test('moving block placement preserves frame-internal x while adapting to the current target width', () => {
  const target = targetWithContainer(1165);
  const controller = {
    document: { defaultView: {} },
    displayScope: () => 'block',
    readingMode: () => 'moving',
  };
  const root = {
    SpeedReadingResponsiveLayout: {
      contentBoxWidth() { return 1165; },
    },
  };
  const frame = {
    kind: 'timed_text',
    placement: {
      display_scope: 'block',
      content_width_px: 1117,
      content_origin_x_px: 24,
      x_px: 124,
      width_px: 120,
    },
  };

  const geometry = Integrity.applyRuntimeHorizontalPlacement(controller, frame, target, root);

  assert.equal(geometry.runtime_origin_x_px, 24);
  assert.equal(geometry.internal_x_px, 100);
  assert.equal(geometry.rendered_left_px, 124);
  assert.equal(target.container.style.left, '124px');
});

test('runtime placement clamps a moving frame inside the current reading target', () => {
  const target = targetWithContainer(500);
  const controller = {
    document: { defaultView: {} },
    displayScope: () => 'block',
    readingMode: () => 'moving',
  };
  const root = {
    SpeedReadingResponsiveLayout: {
      contentBoxWidth() { return 500; },
    },
  };
  const frame = {
    kind: 'timed_text',
    placement: {
      display_scope: 'block',
      content_width_px: 460,
      content_origin_x_px: 24,
      x_px: 430,
      width_px: 100,
    },
  };

  const geometry = Integrity.applyRuntimeHorizontalPlacement(controller, frame, target, root);

  assert.equal(geometry.rendered_left_px, 400);
  assert.equal(target.container.style.left, '400px');
});

test('reading-mode change rerenders the current frame so stale moving/focus inline geometry cannot survive', () => {
  let changeHandler = null;
  const mode = {
    addEventListener(type, handler) {
      if (type === 'change') changeHandler = handler;
    },
  };
  const currentFrame = { frame_id: 'frame-7' };
  const rendered = [];
  const controller = {
    element(id) { return id === 'trainingMode' ? mode : null; },
    isReaderActive: () => true,
    playback: { currentFrame: () => currentFrame },
    showPlaybackSurface(frame) { rendered.push(frame); },
  };

  assert.equal(Integrity.bindReadingModeRerender(controller), true);
  assert.equal(typeof changeHandler, 'function');
  changeHandler();
  assert.deepEqual(rendered, [currentFrame]);
  assert.equal(Integrity.bindReadingModeRerender(controller), false, 'binding is idempotent');
});