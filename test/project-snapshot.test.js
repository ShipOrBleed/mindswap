const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, getDefaultState, writeState, addToHistory } = require('../src/state');
const { appendMemoryItem } = require('../src/memory');
const { createProjectSnapshot } = require('../src/project-snapshot');

let dir;

function setup() {
  dir = createTempProject('project-snapshot-test');
  ensureDataDir(dir);

  const state = getDefaultState();
  state.project = {
    name: 'snapshot-app',
    language: 'typescript',
    framework: 'Express',
    tech_stack: ['node.js', 'express'],
    package_manager: 'npm',
  };
  state.current_task = {
    description: 'refine MCP paths',
    status: 'in_progress',
    blocker: null,
    next_steps: ['profile hot paths'],
    started_at: '2026-04-24T00:00:00.000Z',
  };
  writeState(dir, state);

  fs.writeFileSync(path.join(dir, '.mindswap', 'decisions.log'), '[2026-04-24T00:00:00Z] [perf] reduce repeated reads\n', 'utf-8');
  addToHistory(dir, {
    timestamp: '2026-04-24T01:00:00.000Z',
    message: 'profiled mcp paths',
    ai_tool: 'Codex',
  });
  appendMemoryItem(dir, {
    type: 'blocker',
    message: 'Need to keep context output small',
    status: 'open',
  });
}

function teardown() {
  cleanup(dir);
}

exports.test_createProjectSnapshot_collects_repo_context_once = () => {
  setup();
  try {
    const snapshot = createProjectSnapshot(dir, { historyLimit: 5, recentCommitLimit: 5 });
    assert.strictEqual(snapshot.state.project.name, 'snapshot-app');
    assert.ok(Array.isArray(snapshot.history));
    assert.strictEqual(snapshot.history.length, 1);
    assert.ok(Array.isArray(snapshot.memory.items));
    assert.strictEqual(snapshot.memory.items.length, 1);
    assert.ok(snapshot.decisions.some(line => line.includes('reduce repeated reads')));
    assert.ok(Array.isArray(snapshot.changedFiles));
    assert.ok(Array.isArray(snapshot.recentCommits));

    const nativeDescriptor = Object.getOwnPropertyDescriptor(snapshot, 'nativeSessions');
    const importedDescriptor = Object.getOwnPropertyDescriptor(snapshot, 'importedSessions');
    const guardrailDescriptor = Object.getOwnPropertyDescriptor(snapshot, 'guardrails');
    assert.strictEqual(typeof nativeDescriptor.get, 'function');
    assert.strictEqual(typeof importedDescriptor.get, 'function');
    assert.strictEqual(typeof guardrailDescriptor.get, 'function');

    const snapshotAgain = createProjectSnapshot(dir, { historyLimit: 5, recentCommitLimit: 5 });
    assert.strictEqual(snapshotAgain, snapshot);

    const state = JSON.parse(fs.readFileSync(path.join(dir, '.mindswap', 'state.json'), 'utf-8'));
    state.current_task.next_steps.push('verify cache invalidation');
    writeState(dir, state);

    const snapshotAfterChange = createProjectSnapshot(dir, { historyLimit: 5, recentCommitLimit: 5 });
    assert.notStrictEqual(snapshotAfterChange, snapshot);

    const lightSnapshot = createProjectSnapshot(dir, {
      historyLimit: 5,
      recentCommitLimit: 5,
      includeNativeSessions: false,
      includeImportedSessions: false,
      includeGuardrails: false,
    });
    assert.deepStrictEqual(lightSnapshot.nativeSessions, []);
    assert.deepStrictEqual(lightSnapshot.importedSessions, []);
    assert.deepStrictEqual(lightSnapshot.guardrails, { warnings: [], surface: [], decisionLines: [] });
  } finally {
    teardown();
  }
};
