const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, writeState, getDefaultState, addToHistory } = require('../src/state');
const { searchContext } = require('../src/mcp-server');

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
