const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, getDefaultState, writeState, addToHistory } = require('../src/state');
const { appendMemoryItem } = require('../src/memory');
const {
  isSqliteAvailable,
  getIndexDbPath,
  rebuildSearchIndex,
  searchIndexedEntries,
} = require('../src/index-store');

let dir;
const globalDir = path.join(os.homedir(), '.mindswap');

function setup() {
  dir = createTempProject('index-store-test');
  ensureDataDir(dir);
  try { fs.rmSync(globalDir, { recursive: true, force: true }); } catch {}

  const state = getDefaultState();
  state.project = {
    name: 'index-app',
    language: 'typescript',
    framework: 'Express',
    tech_stack: ['node.js', 'express', 'sqlite'],
    package_manager: 'npm',
  };
  state.current_task = {
    description: 'improve context indexing',
    status: 'in_progress',
    blocker: 'keep search fast',
    next_steps: ['index repo and global memory'],
    started_at: '2026-05-01T00:00:00.000Z',
  };
  writeState(dir, state);

  fs.writeFileSync(path.join(dir, '.mindswap', 'decisions.log'), [
    '[2026-05-01T00:00:00Z] [search] prefer local indexing over cloud search',
  ].join('\n') + '\n', 'utf-8');

  addToHistory(dir, {
    timestamp: '2026-05-01T01:00:00.000Z',
    message: 'added repo search ranking',
    ai_tool: 'Codex',
  });

  appendMemoryItem(dir, {
    type: 'assumption',
    tag: 'search',
    message: 'Repo memory should outrank unrelated personal memory',
  });

  appendMemoryItem(os.homedir(), {
    type: 'assumption',
    tag: 'style',
    message: 'Prefer concise answers across AI tools',
  });
}

function teardown() {
  cleanup(dir);
  try { fs.rmSync(globalDir, { recursive: true, force: true }); } catch {}
}

exports.test_rebuildSearchIndex_creates_sqlite_db = () => {
  if (!isSqliteAvailable()) return;
  setup();
  try {
    const report = rebuildSearchIndex(dir, { scope: 'all' });
    assert.ok(fs.existsSync(getIndexDbPath(dir)));
    assert.ok(report.indexed > 0);
    assert.strictEqual(report.scope, 'all');
  } finally {
    teardown();
  }
};

exports.test_searchIndexedEntries_returns_repo_and_global_hits = () => {
  if (!isSqliteAvailable()) return;
  setup();
  try {
    rebuildSearchIndex(dir, { scope: 'all' });
    const repoHits = searchIndexedEntries(dir, 'local indexing', { scope: 'repo', limit: 10 });
    assert.ok(repoHits.some(hit => hit.scope === 'repo'));
    assert.ok(repoHits.some(hit => hit.type === 'decision' || hit.type === 'task'));

    const globalHits = searchIndexedEntries(dir, 'concise answers', { scope: 'global', limit: 10 });
    assert.ok(globalHits.some(hit => hit.scope === 'global'));
    assert.ok(globalHits.some(hit => hit.type === 'memory:assumption'));
  } finally {
    teardown();
  }
};
