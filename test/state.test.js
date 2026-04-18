const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureRelayDir, getDefaultState, readState, writeState, updateState, addToHistory, getHistory } = require('../src/state');

let dir;

function setup() {
  dir = createTempProject('state-test');
}

function teardown() {
  cleanup(dir);
}

exports.test_ensureRelayDir_creates_directories = () => {
  setup();
  try {
    const relayDir = ensureRelayDir(dir);
    assert.ok(fs.existsSync(relayDir), '.relay/ should exist');
    assert.ok(fs.existsSync(path.join(relayDir, 'history')), '.relay/history/ should exist');
  } finally {
    teardown();
  }
};

exports.test_getDefaultState_has_required_fields = () => {
  const state = getDefaultState();
  assert.ok(state.version, 'should have version');
  assert.ok(state.project, 'should have project');
  assert.ok(state.current_task, 'should have current_task');
  assert.ok(state.last_checkpoint, 'should have last_checkpoint');
  assert.strictEqual(state.current_task.status, 'idle');
};

exports.test_writeState_and_readState_roundtrip = () => {
  setup();
  try {
    ensureRelayDir(dir);
    const state = getDefaultState();
    state.project.name = 'test-project';
    writeState(dir, state);
    const loaded = readState(dir);
    assert.strictEqual(loaded.project.name, 'test-project');
    assert.strictEqual(loaded.version, state.version);
  } finally {
    teardown();
  }
};

exports.test_readState_returns_default_when_missing = () => {
  setup();
  try {
    const state = readState(dir);
    assert.strictEqual(state.current_task.status, 'idle');
  } finally {
    teardown();
  }
};

exports.test_updateState_merges_deeply = () => {
  setup();
  try {
    ensureRelayDir(dir);
    const state = getDefaultState();
    state.project.name = 'original';
    state.current_task.description = 'task1';
    writeState(dir, state);

    updateState(dir, { current_task: { status: 'in_progress' } });
    const loaded = readState(dir);
    assert.strictEqual(loaded.current_task.status, 'in_progress');
    assert.strictEqual(loaded.current_task.description, 'task1', 'should preserve other fields');
    assert.strictEqual(loaded.project.name, 'original', 'should preserve project');
  } finally {
    teardown();
  }
};

exports.test_addToHistory_and_getHistory = () => {
  setup();
  try {
    ensureRelayDir(dir);
    addToHistory(dir, { timestamp: '2026-01-01', message: 'first' });
    // Small delay to ensure different filenames (timestamp-based)
    const origDateNow = Date.now;
    Date.now = () => origDateNow() + 1000;
    addToHistory(dir, { timestamp: '2026-01-02', message: 'second' });
    Date.now = origDateNow;

    const history = getHistory(dir, 10);
    assert.ok(history.length >= 2, `expected at least 2 entries, got ${history.length}`);
    // Both entries should be present
    const messages = history.map(h => h.message);
    assert.ok(messages.includes('first'), 'should contain "first"');
    assert.ok(messages.includes('second'), 'should contain "second"');
  } finally {
    teardown();
  }
};

exports.test_getHistory_respects_limit = () => {
  setup();
  try {
    ensureRelayDir(dir);
    for (let i = 0; i < 5; i++) {
      addToHistory(dir, { timestamp: `2026-01-0${i + 1}`, message: `entry-${i}` });
    }
    const history = getHistory(dir, 2);
    assert.strictEqual(history.length, 2);
  } finally {
    teardown();
  }
};
