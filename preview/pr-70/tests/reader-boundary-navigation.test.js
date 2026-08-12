const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Boundary = require('../reader-boundary-navigation.js');

test('starting a new boundary task invalidates the previous task immediately', () => {
  const updates = [];
  const coordinator = Boundary.createTaskCoordinator((message, task) => {
    updates.push([message, task?.kind || null]);
  });
  const first = coordinator.begin('reader-end', 'locating end');
  assert.equal(coordinator.isCurrent(first), true);
  const second = coordinator.begin('reader-start', 'locating start');
  assert.equal(coordinator.isCurrent(first), false);
  assert.equal(coordinator.isCurrent(second), true);
  assert.equal(coordinator.update(first, 'stale'), false);
  assert.equal(coordinator.update(second, 'current'), true);
  assert.equal(coordinator.finish(first), false);
  assert.equal(coordinator.finish(second), true);
  assert.deepEqual(updates, [
    ['locating end', 'reader-end'],
    ['locating start', 'reader-start'],
    ['current', 'reader-start'],
    ['', null],
  ]);
});

test('cancel invalidates an in-flight boundary task without waiting for its request', () => {
  const updates = [];
  const coordinator = Boundary.createTaskCoordinator((message) => updates.push(message));
  const token = coordinator.begin('playback-end', 'scanning');
  assert.equal(coordinator.cancel(), true);
  assert.equal(coordinator.isCurrent(token), false);
  assert.equal(coordinator.update(token, 'late response'), false);
  assert.deepEqual(updates, ['scanning', '']);
});

test('Preview runtime loads the boundary coordinator with the exact preview head version', () => {
  const source = fs.readFileSync('preview-runtime.js', 'utf8');
  assert.match(source, /reader-boundary-navigation\.js/);
  assert.match(source, /reader-preview-head/);
  assert.match(source, /installWithRetry/);
});