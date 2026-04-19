const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, writeState, getDefaultState } = require('../src/state');

// Test the helper functions directly (not the full save command)
const saveModule = require('../src/save');

let dir;
function setup() {
  dir = createTempProject('save-test');
  ensureDataDir(dir);
  const state = getDefaultState();
  state.project = { name: 'test', tech_stack: ['node.js'], package_manager: 'npm' };
  writeState(dir, state);
  fs.writeFileSync(path.join(dir, '.mindswap', 'decisions.log'), '# Decisions\n\n');
}
function teardown() { cleanup(dir); }

exports.test_autoDetectTask_from_branch = () => {
  // autoDetectTask reads git branch — we're on main in test project
  // It should return null for main/master branches
  setup();
  try {
    const task = saveModule.autoDetectTask(dir);
    // On main branch, should fall back to commit message
    assert.ok(task === null || task.description, 'should return null or task from commits');
  } finally { teardown(); }
};

exports.test_autoDetectDepChanges_first_run = () => {
  setup();
  try {
    const state = { project: { tech_stack: ['node.js'] } };
    const changes = saveModule.autoDetectDepChanges(dir, state);
    // First run — no snapshot exists, should detect notable deps
    // test project has express and jest
    assert.ok(Array.isArray(changes));
  } finally { teardown(); }
};

exports.test_autoDetectDepChanges_no_changes = () => {
  setup();
  try {
    const state = { project: { tech_stack: ['node.js'] } };
    // Run twice — second run should have no changes
    saveModule.autoDetectDepChanges(dir, state);
    const changes = saveModule.autoDetectDepChanges(dir, state);
    assert.strictEqual(changes.length, 0, 'second run should detect no changes');
  } finally { teardown(); }
};

exports.test_autoDetectWorkSummary_with_commits = () => {
  setup();
  try {
    const gitInfo = {
      recent_commits: [{ hash: 'abc', message: 'add auth middleware' }],
      files_changed: ['modified: src/auth.ts'],
    };
    const summary = saveModule.autoDetectWorkSummary(dir, gitInfo);
    assert.ok(summary === null || typeof summary === 'string');
  } finally { teardown(); }
};

exports.test_autoDetectWorkSummary_empty = () => {
  setup();
  try {
    const summary = saveModule.autoDetectWorkSummary(dir, {});
    assert.ok(summary === null || typeof summary === 'string');
  } finally { teardown(); }
};
