const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, getDefaultState, readState, writeState, updateState, addToHistory, getHistory } = require('../src/state');

let dir;
function setup() { dir = createTempProject('state-test'); }
function teardown() { cleanup(dir); }

exports.test_ensureDataDir_creates_directories = () => {
  setup();
  try {
    const dataDir = ensureDataDir(dir);
    assert.ok(fs.existsSync(dataDir), '.mindswap/ should exist');
    assert.ok(fs.existsSync(path.join(dataDir, 'history')), 'history/ should exist');
    assert.ok(fs.existsSync(path.join(dataDir, 'branches')), 'branches/ should exist');
  } finally { teardown(); }
};

exports.test_getDefaultState_has_required_fields = () => {
  const state = getDefaultState();
  assert.ok(state.version);
  assert.ok(state.project);
  assert.ok(state.current_task);
  assert.ok(state.last_checkpoint);
  assert.strictEqual(state.current_task.status, 'idle');
};

exports.test_writeState_and_readState_roundtrip = () => {
  setup();
  try {
    ensureDataDir(dir);
    const state = getDefaultState();
    state.project.name = 'test-project';
    writeState(dir, state);
    const loaded = readState(dir);
    assert.strictEqual(loaded.project.name, 'test-project');
  } finally { teardown(); }
};

exports.test_readState_returns_default_when_missing = () => {
  setup();
  try {
    const state = readState(dir);
    assert.strictEqual(state.current_task.status, 'idle');
  } finally { teardown(); }
};

exports.test_updateState_merges_deeply = () => {
  setup();
  try {
    ensureDataDir(dir);
    const state = getDefaultState();
    state.project.name = 'original';
    state.current_task.description = 'task1';
    writeState(dir, state);

    updateState(dir, { current_task: { status: 'in_progress' } });
    const loaded = readState(dir);
    assert.strictEqual(loaded.current_task.status, 'in_progress');
    assert.strictEqual(loaded.current_task.description, 'task1');
    assert.strictEqual(loaded.project.name, 'original');
  } finally { teardown(); }
};

exports.test_addToHistory_and_getHistory = () => {
  setup();
  try {
    ensureDataDir(dir);
    addToHistory(dir, { timestamp: '2026-01-01', message: 'first' });
    addToHistory(dir, { timestamp: '2026-01-02', message: 'second' });

    const history = getHistory(dir, 10);
    assert.ok(history.length >= 2, `expected >= 2, got ${history.length}`);
    const messages = history.map(h => h.message);
    assert.ok(messages.includes('first'));
    assert.ok(messages.includes('second'));
  } finally { teardown(); }
};

exports.test_getHistory_respects_limit = () => {
  setup();
  try {
    ensureDataDir(dir);
    for (let i = 0; i < 5; i++) {
      addToHistory(dir, { timestamp: `2026-01-0${i + 1}`, message: `entry-${i}` });
    }
    const history = getHistory(dir, 2);
    assert.strictEqual(history.length, 2);
  } finally { teardown(); }
};

exports.test_branch_aware_state = () => {
  setup();
  try {
    ensureDataDir(dir);
    const state = getDefaultState();
    state.project.name = 'branch-test';
    state.current_task.description = 'main branch task';
    writeState(dir, state);

    // Should have written to branches dir
    const branchesDir = path.join(dir, '.mindswap', 'branches');
    const branchFiles = fs.readdirSync(branchesDir).filter(f => f.endsWith('.json'));
    assert.ok(branchFiles.length >= 1, 'should have branch state file');

    // Read it back
    const loaded = readState(dir);
    assert.strictEqual(loaded.current_task.description, 'main branch task');
  } finally { teardown(); }
};
