const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, writeState, getDefaultState, addToHistory } = require('../src/state');
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

function setup() {
  dir = createTempProject('mcp-search-test');
  ensureDataDir(dir);

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
