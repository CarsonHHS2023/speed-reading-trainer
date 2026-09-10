const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const Resume = require('../reader-resume.js');
const { ReaderSpeedPlaybackUIController } = require('../reader-speed-playback-ui.js');

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function identity(extra = {}) {
  return {
    contract_version: '2',
    document_ref: 'doc-1',
    candidate_id: 'cand-1',
    candidate_schema_id: 'atlas.structured-content.v2',
    candidate_schema_version: 2,
    ...extra,
  };
}

test('resume store serializes stable Reader v2 identity including optional semantic node order', () => {
  const storage = new MemoryStorage();
  const store = new Resume.ReaderResumeStoreV2({ storage });
  const record = Resume.recordForLocation(identity(), identity({
    node_id: 'n620',
    source_unit_id: 'flow-1',
    source_anchor: { kind: 'text_span', start: 6200, end: 6210 },
  }), { nodeOrder: 620, frameId: 'frame-1', frameOrdinal: 2, updatedAt: 123 });
  store.write(record);

  assert.deepEqual(store.read('doc-1'), record);
  assert.equal(record.node_order, 620);
  const serialized = [...storage.values.values()][0];
  for (const forbidden of ['presentation_id', 'page_id', 'scroll', 'token', 'state.content', 'cachedContentBlob']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('legacy resume records preserve missing node_order so one-time migration can detect them', () => {
  const record = Resume.recordForLocation(identity(), identity({ node_id: 'n1' }), { updatedAt: 123 });
  assert.equal(record.node_order, null);
  assert.equal(Resume.normalizeNodeOrder(null), null);
  assert.equal(Resume.normalizeNodeOrder(undefined), null);
  assert.equal(Resume.normalizeNodeOrder(''), null);
  assert.equal(Resume.normalizeNodeOrder(0), 0);
  assert.equal(Resume.normalizeNodeOrder(149), 149);
});

test('candidate changes and malformed old records fail closed', () => {
  const storage = new MemoryStorage();
  const store = new Resume.ReaderResumeStoreV2({ storage });
  const record = Resume.recordForLocation(identity(), identity({ node_id: 'n1' }), { nodeOrder: 0 });
  store.write(record);
  assert.equal(Resume.sameCandidate(record, identity({ candidate_id: 'cand-2' })), false);
  storage.setItem(Resume.storageKey('bad'), JSON.stringify({ version: 99, document_ref: 'bad' }));
  assert.equal(store.read('bad'), null);
  assert.equal(storage.getItem(Resume.storageKey('bad')), null);
});

test('saved Speed frame identity never auto-activates or seeks playback when reopening ordinary Reader', () => {
  const controller = Object.create(ReaderSpeedPlaybackUIController.prototype);
  let seekCalls = 0;
  controller.playback = {
    state: 'idle',
    frames: [{ frame_id: 'saved-frame', identity: { node_id: 'n620' } }],
    seek() { seekCalls += 1; },
  };
  controller.reader = {
    resumeRecord: { frame_id: 'saved-frame', frame_ordinal: 2, node_id: 'n620', node_order: 620 },
  };

  assert.equal(controller.restoreResumeFrame(), false);
  assert.equal(seekCalls, 0);
  assert.equal(controller.playback.state, 'idle');
});

test('resume modules exclude legacy Reader v1/blob/page progress dependencies', () => {
  const source = fs.readFileSync('reader-resume.js', 'utf8') + fs.readFileSync('reader-resume-lifecycle.js', 'utf8');
  for (const forbidden of ['/api/reader/v1', '/api/v1/books/', 'cachedContentBlob', 'state.content', 'tokenizeContent', 'page_id', 'presentation_id']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  const lifecycle = fs.readFileSync('reader-resume-lifecycle.js', 'utf8');
  assert.doesNotMatch(lifecycle, /prototype\.selectBook/);
  assert.match(lifecycle, /clearResume/);
});
