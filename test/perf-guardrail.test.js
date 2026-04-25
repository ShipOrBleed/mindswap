const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, getDefaultState, writeState, addToHistory } = require('../src/state');
const { appendMemoryItem } = require('../src/memory');
const { createProjectSnapshot } = require('../src/project-snapshot');
const { searchContext } = require('../src/mcp-server');

let dir;

function setup() {
  dir = createTempProject('perf-guardrail-test');
  ensureDataDir(dir);

  const state = getDefaultState();
  state.project = {
    name: 'perf-app',
    language: 'typescript',
    framework: 'Express',
    tech_stack: ['node.js', 'express', 'postgres'],
    package_manager: 'npm',
  };
  state.current_task = {
    description: 'keep the hot path light',
    status: 'in_progress',
    blocker: 'watch the repeated reads',
    next_steps: ['reuse the snapshot cache'],
    started_at: '2026-04-25T00:00:00.000Z',
  };
  writeState(dir, state);

  fs.writeFileSync(path.join(dir, '.mindswap', 'decisions.log'), [
    '[2026-04-25T00:00:00Z] [perf] reuse repo snapshots',
    '[2026-04-25T00:00:01Z] [perf] prefer cache hits over repeated reads',
  ].join('\n') + '\n', 'utf-8');

  addToHistory(dir, {
    timestamp: '2026-04-25T01:00:00.000Z',
    message: 'validated cached context reuse',
    ai_tool: 'Codex',
  });

  appendMemoryItem(dir, {
    type: 'blocker',
    tag: 'perf',
    message: 'Do not regress the shared snapshot path',
    status: 'open',
  });
}

function teardown() {
  cleanup(dir);
}

function benchmark(label, iterations, fn, limitMs) {
  const startedAt = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    fn();
  }
  const duration = performance.now() - startedAt;
  assert.ok(
    duration <= limitMs,
    `${label} took ${duration.toFixed(1)}ms for ${iterations} iterations (limit ${limitMs}ms)`
  );
}

exports.test_snapshot_cache_and_search_hot_paths_stay_fast = () => {
  setup();
  try {
    const cold = createProjectSnapshot(dir, { historyLimit: 10, recentCommitLimit: 5 });
    assert.ok(cold.state.project.name === 'perf-app');

    const warmSnapshot = createProjectSnapshot(dir, { historyLimit: 10, recentCommitLimit: 5 });

    benchmark(
      'snapshot cache reuse',
      250,
      () => createProjectSnapshot(dir, { historyLimit: 10, recentCommitLimit: 5 }),
      400
    );

    benchmark(
      'search hot path',
      60,
      () => searchContext(dir, 'perf', 'all', warmSnapshot),
      850
    );
  } finally {
    teardown();
  }
};
