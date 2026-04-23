const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, getDefaultState, writeState } = require('../src/state');
const { analyzeProjectHealth } = require('../src/doctor');

let dir;
function setup() { dir = createTempProject('doctor-test'); }
function teardown() { cleanup(dir); }

exports.test_doctor_reports_uninitialized_project = () => {
  setup();
  try {
    const report = analyzeProjectHealth(dir);
    assert.strictEqual(report.status, 'failing');
    assert.ok(report.checks.some(check => check.message.includes('not initialized')));
  } finally { teardown(); }
};

exports.test_doctor_reports_healthy_initialized_project = () => {
  setup();
  try {
    const dataDir = ensureDataDir(dir);
    const state = getDefaultState();
    state.project.name = 'test-project';
    state.project.language = 'javascript';
    state.project.framework = 'Express';
    state.project.tech_stack = ['node.js', 'express'];
    state.current_task.description = 'ship doctor command';
    state.current_task.status = 'in_progress';
    state.current_task.started_at = new Date().toISOString();
    state.last_checkpoint.timestamp = new Date().toISOString();
    state.last_checkpoint.message = 'saved state';
    state.test_status = { status: 'pass', passed: 5, failed: 0, total: 5 };
    state.build_status = { status: 'pass' };
    writeState(dir, state);

    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ auto_checkpoint_on_commit: true }, null, 2));
    fs.writeFileSync(path.join(dataDir, 'decisions.log'), '# Decision Log\n');
    fs.writeFileSync(path.join(dataDir, 'HANDOFF.md'), '# local handoff\n');
    fs.writeFileSync(path.join(dir, 'HANDOFF.md'), '# project handoff\n');
    fs.writeFileSync(path.join(dir, '.git', 'hooks', 'post-commit'), '#!/bin/sh\nnpx mindswap save --quiet 2>/dev/null || true\n');

    const report = analyzeProjectHealth(dir);
    assert.notStrictEqual(report.status, 'failing');
    assert.ok(report.checks.some(check => check.message.includes('post-commit hook includes mindswap auto-save')));
    assert.ok(report.checks.some(check => check.message.includes('HANDOFF.md exists at project root')));
  } finally { teardown(); }
};

exports.test_doctor_flags_missing_hook_and_stale_handoff = () => {
  setup();
  try {
    const dataDir = ensureDataDir(dir);
    const state = getDefaultState();
    state.project.name = 'test-project';
    state.project.language = 'javascript';
    state.project.tech_stack = ['node.js', 'express', 'jest'];
    writeState(dir, state);

    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({}, null, 2));
    fs.writeFileSync(path.join(dataDir, 'decisions.log'), '# Decision Log\n');
    fs.writeFileSync(path.join(dataDir, 'HANDOFF.md'), '# local handoff\n');
    fs.writeFileSync(path.join(dir, 'HANDOFF.md'), '# project handoff\n');

    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(path.join(dataDir, 'HANDOFF.md'), old, old);
    fs.utimesSync(path.join(dir, 'HANDOFF.md'), old, old);

    const report = analyzeProjectHealth(dir);
    assert.ok(report.checks.some(check => check.message.includes('post-commit hook is missing')));
    assert.ok(report.checks.some(check => check.message.includes('looks stale')));
  } finally { teardown(); }
};

exports.test_doctor_flags_ai_tool_context_gaps = () => {
  setup();
  try {
    const dataDir = ensureDataDir(dir);
    const state = getDefaultState();
    state.project.name = 'test-project';
    state.project.language = 'javascript';
    state.project.tech_stack = ['node.js', 'express', 'cursor'];
    writeState(dir, state);

    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({}, null, 2));
    fs.writeFileSync(path.join(dataDir, 'decisions.log'), '# Decision Log\n');
    fs.writeFileSync(path.join(dataDir, 'HANDOFF.md'), '# local handoff\n');
    fs.writeFileSync(path.join(dir, 'HANDOFF.md'), '# project handoff\n');
    fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });

    const report = analyzeProjectHealth(dir);
    assert.ok(report.checks.some(check => check.message.includes('Cursor context file is missing')));
  } finally { teardown(); }
};
