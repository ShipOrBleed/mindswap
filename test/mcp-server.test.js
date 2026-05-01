const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, writeState, getDefaultState, addToHistory } = require('../src/state');
const { readMemory } = require('../src/memory');
const { getIndexDbPath } = require('../src/index-store');
const {
  searchContext,
  manageMemory,
  readStableResource,
  buildStartWorkPrompt,
  buildResumeWorkPrompt,
  buildHandoffPrompt,
  buildConflictReviewPrompt,
} = require('../src/mcp-server');

let dir;
const globalDir = path.join(os.homedir(), '.mindswap');

function setup() {
  dir = createTempProject('mcp-search-test');
  ensureDataDir(dir);
  try { fs.rmSync(globalDir, { recursive: true, force: true }); } catch {}

  const state = getDefaultState();
  state.project = {
    name: 'search-app',
    language: 'typescript',
    framework: 'Express',
    tech_stack: ['node.js', 'express', 'postgres'],
    package_manager: 'npm',
  };
  state.current_task = {
    description: 'implement login flow',
    status: 'in_progress',
    blocker: 'waiting on token refresh behavior',
    next_steps: ['wire JWT refresh'],
    started_at: '2026-04-23T00:00:00.000Z',
  };
  writeState(dir, state);

  fs.writeFileSync(path.join(dir, '.mindswap', 'decisions.log'), [
    '[2026-04-23T00:00:00Z] [auth] chose JWT over sessions',
    '[2026-04-23T00:00:01Z] [db] chose Postgres over SQLite',
  ].join('\n') + '\n', 'utf-8');

  addToHistory(dir, {
    timestamp: '2026-04-23T01:00:00.000Z',
    message: 'switched database migration to Postgres',
    ai_tool: 'Codex',
  });

  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), [
    '# Project rules',
    '',
    'We prefer JWT for auth instead of sessions.',
    'Use strict naming conventions for auth routes.',
  ].join('\n'), 'utf-8');
}

function teardown() {
  cleanup(dir);
  try { fs.rmSync(globalDir, { recursive: true, force: true }); } catch {}
}

exports.test_searchContext_semantic_ranking_finds_database_matches = () => {
  setup();
  try {
    const result = searchContext(dir, 'database', 'all');
    const text = result.content[0].text;
    assert.ok(text.includes('Postgres over SQLite'), 'should find database-related decision');
    assert.ok(text.includes('switched database migration to Postgres'), 'should rank history item');
  } finally {
    teardown();
  }
};

exports.test_searchContext_semantic_ranking_finds_imported_auth_context = () => {
  setup();
  try {
    const result = searchContext(dir, 'auth', 'all');
    const text = result.content[0].text;
    assert.ok(text.includes('Current task: implement login flow'), 'should find semantically related task');
    assert.ok(text.includes('JWT over sessions'), 'should find auth decision');
    assert.ok(text.includes('Claude Code'), 'should search imported Claude context');
  } finally {
    teardown();
  }
};

exports.test_searchContext_prioritizes_task_and_blocker_results = () => {
  setup();
  try {
    const result = searchContext(dir, 'login', 'all');
    const lines = result.content[0].text.split('\n').filter(Boolean);
    const firstHit = lines.find(line => line.startsWith('['));
    assert.ok(firstHit.includes('[task]') || firstHit.includes('[blocker]'), 'should prioritize task or blocker results');
    assert.ok(lines.some(line => line.includes('Current task: implement login flow') || line.includes('Current blocker: waiting on token refresh behavior')));
  } finally {
    teardown();
  }
};

exports.test_manageMemory_add_list_update_resolve_archive_delete = () => {
  setup();
  try {
    const add = manageMemory(dir, {
      action: 'add',
      type: 'blocker',
      tag: 'auth',
      message: 'Waiting on auth review',
      author: 'Codex',
      source: 'mcp',
      json: true,
    });
    const addPayload = JSON.parse(add.content[0].text);
    assert.strictEqual(addPayload.item.type, 'blocker');
    assert.strictEqual(addPayload.item.status, 'open');

    const list = manageMemory(dir, { action: 'list', type: 'blocker', json: true });
    const listPayload = JSON.parse(list.content[0].text);
    assert.strictEqual(listPayload.count, 1);

    const id = addPayload.item.id;
    const update = manageMemory(dir, {
      action: 'update',
      id,
      message: 'Waiting on auth review from security',
      author: 'Claude',
      json: true,
    });
    const updatePayload = JSON.parse(update.content[0].text);
    assert.strictEqual(updatePayload.item.author, 'Claude');

    const resolve = manageMemory(dir, {
      action: 'resolve',
      id,
      message: 'Auth review approved',
      json: true,
    });
    const resolvePayload = JSON.parse(resolve.content[0].text);
    assert.strictEqual(resolvePayload.item.status, 'resolved');
    assert.ok(resolvePayload.item.resolved_at);

    const archive = manageMemory(dir, {
      action: 'archive',
      id,
      json: true,
    });
    const archivePayload = JSON.parse(archive.content[0].text);
    assert.strictEqual(archivePayload.item.status, 'archived');

    const del = manageMemory(dir, {
      action: 'delete',
      id,
      hard: true,
      json: true,
    });
    const delPayload = JSON.parse(del.content[0].text);
    assert.strictEqual(delPayload.deleted, true);
  } finally {
    teardown();
  }
};

exports.test_manageMemory_add_global_writes_to_home_scope = () => {
  setup();
  try {
    const add = manageMemory(dir, {
      action: 'add',
      type: 'assumption',
      tag: 'style',
      message: 'Prefer concise answers across AI tools',
      scope: 'global',
      json: true,
    });
    const addPayload = JSON.parse(add.content[0].text);
    assert.strictEqual(addPayload.item.type, 'assumption');

    const memory = readMemory(os.homedir());
    assert.ok(memory.items.some(item => item.message.includes('Prefer concise answers across AI tools')));
  } finally {
    teardown();
  }
};

exports.test_searchContext_scope_all_includes_global_memory = () => {
  setup();
  try {
    manageMemory(dir, {
      action: 'add',
      type: 'assumption',
      tag: 'style',
      message: 'Prefer direct explanations across AI tools',
      scope: 'global',
      json: true,
    });

    const result = searchContext(dir, 'direct explanations', 'all', null, { scope: 'all' });
    const text = result.content[0].text;
    assert.ok(text.includes('global:assumption'), 'should label global memory results');
    assert.ok(text.includes('Prefer direct explanations across AI tools'));
  } finally {
    teardown();
  }
};

exports.test_searchContext_prefers_sqlite_index_when_present = () => {
  setup();
  try {
    // Create a synthetic indexed row that doesn't exist in repo files.
    let sqlite;
    try { sqlite = require('node:sqlite'); } catch {}
    if (!sqlite?.DatabaseSync) return;

    const dbPath = getIndexDbPath(dir);
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new sqlite.DatabaseSync(dbPath);
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS documents (
          key TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          type TEXT NOT NULL,
          source TEXT NOT NULL,
          content TEXT NOT NULL
        );
      `);
      db.prepare(`
        INSERT OR REPLACE INTO documents (key, scope, type, source, content)
        VALUES (?, ?, ?, ?, ?)
      `).run('synthetic:key', 'repo', 'history', 'synthetic', 'SYNTHETIC INDEX ONLY HIT');
    } finally {
      db.close();
    }

    const result = searchContext(dir, 'SYNTHETIC', 'all', null, { scope: 'repo' });
    const text = result.content[0].text;
    assert.ok(text.includes('indexed result(s)'), 'should use indexed search when index exists');
    assert.ok(text.includes('SYNTHETIC INDEX ONLY HIT'));
  } finally {
    teardown();
  }
};

exports.test_prompt_templates_include_workflow_guidance = () => {
  setup();
  try {
    const start = buildStartWorkPrompt(dir, { goal: 'ship auth middleware', tool: 'Cursor' });
    assert.ok(start.includes('You are starting work in this repository.'));
    assert.ok(start.includes('ship auth middleware'));
    assert.ok(start.includes('Current Task'));

    const resume = buildResumeWorkPrompt(dir, { compact: true });
    assert.ok(resume.includes('Resume this workstream from the current repo state.'));
    assert.ok(resume.includes('Recommendation:'));
    assert.ok(resume.includes('Resolve the active blocker first') || resume.includes('Continue the active task'));

    const handoff = buildHandoffPrompt(dir, { audience: 'Claude Code' });
    assert.ok(handoff.includes('Prepare a handoff for Claude Code.'));
    assert.ok(handoff.includes('Summarize what changed'));

    const conflicts = buildConflictReviewPrompt(dir, { focus: 'auth' });
    assert.ok(conflicts.includes('Review conflicts with a focus on auth.'));
    assert.ok(conflicts.includes('smallest safe resolution'));
  } finally {
    teardown();
  }
};

exports.test_stable_resources_export_context_state_memory_and_handoff = () => {
  setup();
  try {
    const context = readStableResource(dir, 'context');
    const contextText = context.contents[0].text;
    assert.ok(contextText.includes('TL;DR'));
    assert.ok(contextText.includes('Current Task'));

    const state = readStableResource(dir, 'state');
    const statePayload = JSON.parse(state.contents[0].text);
    assert.strictEqual(statePayload.project.name, 'search-app');

    const decisions = readStableResource(dir, 'decisions');
    const decisionsPayload = JSON.parse(decisions.contents[0].text);
    assert.ok(Array.isArray(decisionsPayload.decisions));
    assert.ok(Array.isArray(decisionsPayload.conflicts));

    const memory = readStableResource(dir, 'memory');
    const memoryPayload = JSON.parse(memory.contents[0].text);
    assert.ok(Array.isArray(memoryPayload.items));

    const handoff = readStableResource(dir, 'handoff');
    const handoffText = handoff.contents[0].text;
    assert.ok(handoffText.includes('Project'));
  } finally {
    teardown();
  }
};
