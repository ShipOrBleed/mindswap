const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, getDefaultState, writeState, readState } = require('../src/state');
const { ask, parseSearchResults, buildAnswerPayload } = require('../src/ask');

let dir;

function setup() {
  dir = createTempProject('ask-test');
  ensureDataDir(dir);

  const state = getDefaultState();
  state.project = {
    name: 'ask-app',
    language: 'typescript',
    framework: 'Express',
    tech_stack: ['node.js', 'express', 'postgres'],
    package_manager: 'npm',
  };
  state.current_task = {
    description: 'implement login flow',
    status: 'in_progress',
    blocker: null,
    next_steps: ['wire JWT refresh'],
    started_at: '2026-04-23T00:00:00.000Z',
  };
  writeState(dir, state);

  fs.writeFileSync(path.join(dir, '.mindswap', 'decisions.log'), [
    '[2026-04-23T00:00:00Z] [auth] chose JWT over sessions',
    '[2026-04-23T00:00:01Z] [db] chose Postgres over SQLite',
  ].join('\n') + '\n', 'utf-8');

  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), [
    '# Project rules',
    '',
    'We prefer JWT for auth instead of sessions.',
  ].join('\n'), 'utf-8');
}

function teardown() {
  cleanup(dir);
}

exports.test_parseSearchResults_extracts_ranked_items = () => {
  const parsed = parseSearchResults([
    'Found 2 result(s) for "auth":',
    '',
    '[decision] (12) [2026-04-23T00:00:00Z] [auth] chose JWT over sessions',
    '[history] (8) [2026-04-23T01:00:00.000Z] switched database migration to Postgres',
  ].join('\n'));
  assert.strictEqual(parsed.length, 2);
  assert.strictEqual(parsed[0].type, 'decision');
  assert.strictEqual(parsed[0].score, 12);
};

exports.test_buildAnswerPayload_synthesizes_answer_with_sources = () => {
  setup();
  try {
    const payload = buildAnswerPayload('why did we choose jwt?', [
      { type: 'decision', score: 12, content: '[2026-04-23T00:00:00Z] [auth] chose JWT over sessions' },
      { type: 'history', score: 9, content: '[2026-04-23T01:00:00.000Z] switched database migration to Postgres' },
    ], readState(dir));
    assert.ok(payload.answer.includes('JWT'));
    assert.strictEqual(payload.sources.length, 2);
    assert.ok(payload.next_step.includes('npx mindswap search'));
  } finally {
    teardown();
  }
};

exports.test_ask_outputs_text_and_json = async () => {
  setup();
  try {
    const originalLog = console.log;
    const lines = [];
    console.log = (...args) => {
      lines.push(args.join(' '));
    };

    try {
      await ask(dir, 'why did we choose jwt?', {});
      assert.ok(lines.join('\n').includes('Ask'));
      assert.ok(lines.join('\n').includes('JWT'));
      lines.length = 0;
      await ask(dir, 'why did we choose jwt?', { json: true });
      const parsed = JSON.parse(lines.join('\n'));
      assert.ok(parsed.answer.includes('JWT'));
      assert.ok(Array.isArray(parsed.sources));
    } finally {
      console.log = originalLog;
    }
  } finally {
    teardown();
  }
};
