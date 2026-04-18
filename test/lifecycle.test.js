const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, writeState, readState, getDefaultState, getHistory } = require('../src/state');
const { done, reset } = require('../src/lifecycle');

let dir;
function setup() {
  dir = createTempProject('lifecycle-test');
  ensureDataDir(dir);
  const state = getDefaultState();
  state.project = { name: 'test', tech_stack: [], package_manager: 'npm' };
  state.current_task = {
    description: 'build auth', status: 'in_progress',
    started_at: '2026-01-01', blocker: null, next_steps: ['add JWT'],
  };
  writeState(dir, state);
  fs.writeFileSync(path.join(dir, '.mindswap', 'decisions.log'),
    '# Decisions\n\n[2026-01-01] [auth] chose JWT\n', 'utf-8');
}
function teardown() { cleanup(dir); }

exports.test_done_marks_task_completed = async () => {
  setup();
  try {
    console.log = () => {};
    await done(dir, 'shipped');
    console.log = global.console.log;
    const state = readState(dir);
    assert.strictEqual(state.current_task.status, 'idle');
    assert.strictEqual(state.current_task.description, '');
  } finally { teardown(); }
};

exports.test_done_archives_to_history = async () => {
  setup();
  try {
    console.log = () => {};
    await done(dir, 'completed note');
    console.log = global.console.log;
    const history = getHistory(dir, 10);
    assert.ok(history.length >= 1);
    const entry = history.find(h => h.type === 'task_completed');
    assert.ok(entry);
    assert.strictEqual(entry.task.completion_note, 'completed note');
  } finally { teardown(); }
};

exports.test_done_noop_when_no_active_task = async () => {
  setup();
  try {
    const state = getDefaultState();
    state.project = { name: 'test', tech_stack: [], package_manager: 'npm' };
    writeState(dir, state);
    let output = '';
    console.log = (msg) => { output += msg; };
    await done(dir);
    console.log = global.console.log;
    assert.ok(output.includes('No active task'));
  } finally { teardown(); }
};

exports.test_reset_clears_task_and_checkpoint = async () => {
  setup();
  try {
    console.log = () => {};
    await reset(dir, {});
    console.log = global.console.log;
    const state = readState(dir);
    assert.strictEqual(state.current_task.status, 'idle');
    assert.strictEqual(state.current_task.description, '');
    assert.strictEqual(state.last_checkpoint.timestamp, null);
  } finally { teardown(); }
};

exports.test_reset_preserves_decisions_by_default = async () => {
  setup();
  try {
    console.log = () => {};
    await reset(dir, {});
    console.log = global.console.log;
    const decisions = fs.readFileSync(path.join(dir, '.mindswap', 'decisions.log'), 'utf-8');
    assert.ok(decisions.includes('chose JWT'));
  } finally { teardown(); }
};

exports.test_reset_full_clears_decisions = async () => {
  setup();
  try {
    console.log = () => {};
    await reset(dir, { full: true });
    console.log = global.console.log;
    const decisions = fs.readFileSync(path.join(dir, '.mindswap', 'decisions.log'), 'utf-8');
    assert.ok(!decisions.includes('chose JWT'));
    assert.ok(decisions.includes('Decision Log'));
  } finally { teardown(); }
};
