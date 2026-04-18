const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureRelayDir, writeState, readState, getDefaultState, getHistory } = require('../src/state');
const { done, reset } = require('../src/lifecycle');

let dir;

function setup() {
  dir = createTempProject('lifecycle-test');
  ensureRelayDir(dir);
  const state = getDefaultState();
  state.project = { name: 'test', tech_stack: [], package_manager: 'npm' };
  state.current_task = {
    description: 'build auth',
    status: 'in_progress',
    started_at: '2026-01-01',
    blocker: null,
    next_steps: ['add JWT'],
  };
  writeState(dir, state);
  fs.writeFileSync(
    path.join(dir, '.relay', 'decisions.log'),
    '# Decisions\n\n[2026-01-01] [auth] chose JWT\n',
    'utf-8'
  );
}

function teardown() {
  cleanup(dir);
}

exports.test_done_marks_task_completed_and_resets = async () => {
  setup();
  try {
    const origLog = console.log;
    console.log = () => {};
    await done(dir, 'auth is shipped');
    console.log = origLog;

    const state = readState(dir);
    assert.strictEqual(state.current_task.status, 'idle');
    assert.strictEqual(state.current_task.description, '');
  } finally {
    teardown();
  }
};

exports.test_done_archives_to_history = async () => {
  setup();
  try {
    const origLog = console.log;
    console.log = () => {};
    await done(dir, 'completed note');
    console.log = origLog;

    const history = getHistory(dir, 10);
    assert.ok(history.length >= 1, 'should have history entry');
    const entry = history.find(h => h.type === 'task_completed');
    assert.ok(entry, 'should have a task_completed entry');
    assert.ok(entry.task.completion_note === 'completed note');
  } finally {
    teardown();
  }
};

exports.test_done_noop_when_no_active_task = async () => {
  setup();
  try {
    const state = getDefaultState();
    state.project = { name: 'test', tech_stack: [], package_manager: 'npm' };
    writeState(dir, state);

    const origLog = console.log;
    let output = '';
    console.log = (msg) => { output += msg; };
    await done(dir);
    console.log = origLog;

    assert.ok(output.includes('No active task'), 'should warn about no active task');
  } finally {
    teardown();
  }
};

exports.test_reset_clears_task_and_checkpoint = async () => {
  setup();
  try {
    const origLog = console.log;
    console.log = () => {};
    await reset(dir, {});
    console.log = origLog;

    const state = readState(dir);
    assert.strictEqual(state.current_task.status, 'idle');
    assert.strictEqual(state.current_task.description, '');
    assert.strictEqual(state.last_checkpoint.timestamp, null);
  } finally {
    teardown();
  }
};

exports.test_reset_preserves_decisions_by_default = async () => {
  setup();
  try {
    const origLog = console.log;
    console.log = () => {};
    await reset(dir, {});
    console.log = origLog;

    const decisions = fs.readFileSync(path.join(dir, '.relay', 'decisions.log'), 'utf-8');
    assert.ok(decisions.includes('chose JWT'), 'should preserve decisions');
  } finally {
    teardown();
  }
};

exports.test_reset_full_clears_decisions = async () => {
  setup();
  try {
    const origLog = console.log;
    console.log = () => {};
    await reset(dir, { full: true });
    console.log = origLog;

    const decisions = fs.readFileSync(path.join(dir, '.relay', 'decisions.log'), 'utf-8');
    assert.ok(!decisions.includes('chose JWT'), 'should clear decisions on full reset');
    assert.ok(decisions.includes('Decision Log'), 'should keep the header');
  } finally {
    teardown();
  }
};
