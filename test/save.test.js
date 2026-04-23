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

exports.test_autoDetectDepChanges_python_requirements = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'fastapi==0.111.0\nredis==5.0.1\n');
    const state = { project: { tech_stack: ['python'] } };
    const changes = saveModule.autoDetectDepChanges(dir, state);
    assert.ok(changes.some(change => change.includes('FastAPI')), `expected FastAPI change, got ${changes.join(', ')}`);
    assert.ok(changes.some(change => change.includes('Redis')), `expected Redis change, got ${changes.join(', ')}`);
  } finally { teardown(); }
};

exports.test_autoDetectDepChanges_go_mod = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, 'go.mod'), `module example.com/test\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.10.0\n\tgithub.com/redis/go-redis/v9 v9.5.1\n)\n`);
    const state = { project: { tech_stack: ['go'] } };
    const changes = saveModule.autoDetectDepChanges(dir, state);
    assert.ok(changes.some(change => change.includes('Gin')), `expected Gin change, got ${changes.join(', ')}`);
    assert.ok(changes.some(change => change.includes('Redis')), `expected Redis change, got ${changes.join(', ')}`);
  } finally { teardown(); }
};

exports.test_autoDetectDepChanges_cargo = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), `[package]\nname = "test"\nversion = "0.1.0"\n\n[dependencies]\naxum = "0.7"\nredis = "0.25"\n`);
    const state = { project: { tech_stack: ['rust'] } };
    const changes = saveModule.autoDetectDepChanges(dir, state);
    assert.ok(changes.some(change => change.includes('Axum')), `expected Axum change, got ${changes.join(', ')}`);
    assert.ok(changes.some(change => change.includes('Redis')), `expected Redis change, got ${changes.join(', ')}`);
  } finally { teardown(); }
};

exports.test_autoDetectDepChanges_gemfile = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, 'Gemfile'), `source "https://rubygems.org"\ngem "rails", "~> 7.1"\ngem "sidekiq", "~> 7.2"\n`);
    const state = { project: { tech_stack: ['ruby'] } };
    const changes = saveModule.autoDetectDepChanges(dir, state);
    assert.ok(changes.some(change => change.includes('Rails')), `expected Rails change, got ${changes.join(', ')}`);
    assert.ok(changes.some(change => change.includes('Sidekiq')), `expected Sidekiq change, got ${changes.join(', ')}`);
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
