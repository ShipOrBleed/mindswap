const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir } = require('../src/state');
const { ensureMemory, appendMemoryItem, readMemory, getOpenMemoryItems } = require('../src/memory');

let dir;
function setup() {
  dir = createTempProject('memory-test');
  ensureDataDir(dir);
  ensureMemory(dir);
}
function teardown() { cleanup(dir); }

exports.test_ensureMemory_creates_memory_json = () => {
  setup();
  try {
    assert.ok(fs.existsSync(path.join(dir, '.mindswap', 'memory.json')));
  } finally { teardown(); }
};

exports.test_appendMemoryItem_persists_items = () => {
  setup();
  try {
    appendMemoryItem(dir, { type: 'question', tag: 'auth', message: 'Should we rotate refresh tokens?' });
    const memory = readMemory(dir);
    assert.strictEqual(memory.items.length, 1);
    assert.strictEqual(memory.items[0].type, 'question');
  } finally { teardown(); }
};

exports.test_getOpenMemoryItems_filters_by_type = () => {
  setup();
  try {
    appendMemoryItem(dir, { type: 'blocker', message: 'Webhook secret not provisioned' });
    appendMemoryItem(dir, { type: 'assumption', message: 'Using a single region for MVP' });
    const blockers = getOpenMemoryItems(dir, 'blocker', 5);
    assert.strictEqual(blockers.length, 1);
    assert.strictEqual(blockers[0].message, 'Webhook secret not provisioned');
  } finally { teardown(); }
};
