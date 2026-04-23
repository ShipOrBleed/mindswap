const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const {
  ensureDataDir,
  getDefaultState,
  writeState,
  readState,
  addToHistory,
  getHistory,
} = require('../src/state');
const { readMemory, writeMemory } = require('../src/memory');
const { sync, buildSyncReport, writeHubSnapshot } = require('../src/sync');
const { analyzeProjectHealth } = require('../src/doctor');

let dir;

function setup() {
  dir = createTempProject('sync-test');
  ensureDataDir(dir);
}

function teardown() {
  cleanup(dir);
}

function seedLocalState(overrides = {}) {
  const state = getDefaultState();
  state.project.name = 'sync-app';
  state.project.language = 'typescript';
  state.project.tech_stack = ['node.js', 'express'];
  state.current_task.description = 'work on shared sync';
  state.current_task.status = 'in_progress';
  state.current_task.started_at = '2026-04-23T00:00:00.000Z';
  state.last_checkpoint.timestamp = '2026-04-23T00:00:00.000Z';
  Object.assign(state, overrides);
  writeState(dir, state);
}

exports.test_buildSyncReport_marks_divergence_by_mode = () => {
  setup();
  try {
    const local = {
      updated_at: '2026-04-23T10:00:00.000Z',
      branch: 'main',
      history: [],
      memory: { items: [] },
    };
    const hub = {
      updated_at: '2026-04-23T09:00:00.000Z',
      branch: 'main',
      history: [],
      memory: { items: [] },
    };

    const statusReport = buildSyncReport({ local, hub, hubPath: '/tmp/sync-hub.json', mode: 'status' });
    const pushReport = buildSyncReport({ local, hub, hubPath: '/tmp/sync-hub.json', mode: 'push' });
    const pullReport = buildSyncReport({ local, hub, hubPath: '/tmp/sync-hub.json', mode: 'pull' });

    assert.strictEqual(statusReport.status, 'local-ahead');
    assert.strictEqual(statusReport.conflict, true);
    assert.strictEqual(pushReport.conflict, false);
    assert.strictEqual(pullReport.conflict, true);
  } finally {
    teardown();
  }
};

exports.test_sync_push_writes_shared_hub_snapshot = () => {
  setup();
  try {
    seedLocalState();
    writeMemory(dir, {
      version: '1.0.0',
      items: [
        {
          id: 'mem-1',
          type: 'decision',
          tag: 'sync',
          message: 'Use shared hub state',
          status: 'open',
          created_at: '2026-04-23T00:00:00.000Z',
          resolved_at: null,
          source: 'cli',
          metadata: {},
        },
      ],
    });
    addToHistory(dir, {
      timestamp: '2026-04-23T00:10:00.000Z',
      message: 'initial sync state',
      type: 'checkpoint',
      ai_tool: 'mindswap',
    });

    const hubPath = path.join(dir, 'shared', 'sync-hub.json');
    sync(dir, { push: true, hub: hubPath });

    assert.ok(fs.existsSync(hubPath), 'push should create the hub file');

    const hub = JSON.parse(fs.readFileSync(hubPath, 'utf-8'));
    assert.strictEqual(hub.state.project.name, 'sync-app');
    assert.strictEqual(hub.memory.items.length, 1);
    assert.strictEqual(hub.history.length, 1);
    assert.ok(getHistory(dir, 10).some(item => item.type === 'sync_push'));
  } finally {
    teardown();
  }
};

exports.test_sync_pull_merges_state_memory_and_history_once = () => {
  setup();
  try {
    seedLocalState();
    writeMemory(dir, {
      version: '1.0.0',
      items: [
        {
          id: 'local-mem',
          type: 'decision',
          tag: 'sync',
          message: 'Local item',
          status: 'open',
          created_at: '2026-04-23T00:00:00.000Z',
          resolved_at: null,
          source: 'cli',
          metadata: {},
        },
      ],
    });
    addToHistory(dir, {
      timestamp: '2026-04-23T00:10:00.000Z',
      message: 'local checkpoint',
      type: 'checkpoint',
      ai_tool: 'mindswap',
    });

    const hubPath = path.join(dir, 'shared', 'sync-hub.json');
    writeHubSnapshot(hubPath, {
      version: '1.0.0',
      updated_at: '2026-04-23T01:00:00.000Z',
      branch: 'main',
      state: {
        project: {
          name: 'sync-app',
          root: '',
          tech_stack: ['node.js', 'express', 'postgres'],
          package_manager: 'npm',
        },
        current_task: {
          description: 'work on shared sync',
          started_at: '2026-04-23T00:00:00.000Z',
          status: 'in_progress',
          blocker: 'waiting on shared access',
          next_steps: [],
        },
        last_checkpoint: {
          timestamp: '2026-04-23T01:00:00.000Z',
          message: 'hub checkpoint',
          ai_tool: 'mindswap',
          files_changed: [],
          git_branch: 'main',
          git_diff_summary: '',
        },
      },
      history: [
        {
          timestamp: '2026-04-23T01:00:00.000Z',
          message: 'hub checkpoint',
          type: 'checkpoint',
          ai_tool: 'mindswap',
        },
      ],
      memory: {
        version: '1.0.0',
        items: [
          {
            id: 'hub-mem',
            type: 'question',
            tag: 'sync',
            message: 'Is the hub shared?',
            status: 'open',
            created_at: '2026-04-23T01:00:00.000Z',
            resolved_at: null,
            source: 'cli',
            metadata: {},
          },
        ],
      },
    });

    sync(dir, { pull: true, hub: hubPath });
    const afterFirstPull = readState(dir);
    const afterFirstMemory = readMemory(dir);
    const afterFirstHistory = getHistory(dir, 20);

    assert.strictEqual(afterFirstPull.project.tech_stack.includes('postgres'), true);
    assert.ok(afterFirstMemory.items.some(item => item.id === 'hub-mem'));
    assert.strictEqual(afterFirstHistory.filter(item => item.message === 'hub checkpoint').length, 1);

    sync(dir, { pull: true, hub: hubPath });
    const afterSecondHistory = getHistory(dir, 20);
    assert.strictEqual(afterSecondHistory.filter(item => item.message === 'hub checkpoint').length, 1, 'pull should not duplicate shared history entries');
    assert.ok(afterSecondHistory.some(item => item.type === 'sync_pull'));
  } finally {
    teardown();
  }
};

exports.test_doctor_reports_shared_sync_hub_health = () => {
  setup();
  try {
    seedLocalState({
      last_checkpoint: {
        timestamp: '2026-04-23T01:00:00.000Z',
        message: 'hub checkpoint',
        ai_tool: 'mindswap',
        files_changed: [],
        git_branch: 'main',
        git_diff_summary: '',
      },
    });
    const hubPath = path.join(dir, '.mindswap', 'sync-hub.json');
    writeHubSnapshot(hubPath, {
      version: '1.0.0',
      updated_at: '2026-04-23T01:00:00.000Z',
      branch: 'main',
      state: readState(dir),
      history: [],
      memory: { version: '1.0.0', items: [] },
    });

    const report = analyzeProjectHealth(dir);
    assert.ok(report.checks.some(check => check.message.includes('shared sync hub status')));
  } finally {
    teardown();
  }
};
