const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, writeState, getDefaultState, addToHistory } = require('../src/state');
const { getAuthorIdentity, teamSection } = require('../src/team');
const { generate } = require('../src/generate');

let dir;

function setup() {
  dir = createTempProject('team-test');
  ensureDataDir(dir);

  const state = getDefaultState();
  state.project = {
    name: 'team-app',
    language: 'typescript',
    framework: 'Express',
    tech_stack: ['node.js', 'express'],
    package_manager: 'npm',
  };
  state.current_task = {
    description: 'coordinate release',
    status: 'in_progress',
    blocker: null,
    next_steps: ['handoff to frontend'],
    started_at: '2026-04-23T00:00:00.000Z',
  };
  writeState(dir, state);
}

function teardown() {
  cleanup(dir);
}

exports.test_getAuthorIdentity_reads_git_config = () => {
  setup();
  try {
    const author = getAuthorIdentity(dir);
    assert.ok(author.includes('Test'), 'should use git user.name');
    assert.ok(author.includes('test@mindswap.dev'), 'should include git user.email');
  } finally {
    teardown();
  }
};

exports.test_addToHistory_includes_author_metadata = () => {
  setup();
  try {
    const file = addToHistory(dir, {
      timestamp: '2026-04-23T01:00:00.000Z',
      message: 'shared handoff note',
    });
    const entry = JSON.parse(fs.readFileSync(path.join(dir, '.mindswap', 'history', file), 'utf-8'));
    assert.ok(entry.author, 'should annotate history with author');
    assert.strictEqual(entry.team_mode, false);
  } finally {
    teardown();
  }
};

exports.test_generate_includes_team_section_when_enabled = async () => {
  setup();
  const original = process.env.MINDSWAP_TEAM;
  process.env.MINDSWAP_TEAM = '1';
  try {
    addToHistory(dir, {
      timestamp: '2026-04-23T01:00:00.000Z',
      message: 'handoff from backend',
    });
    console.log = () => {};
    await generate(dir, { handoff: true });
    console.log = global.console.log;
    const handoff = fs.readFileSync(path.join(dir, 'HANDOFF.md'), 'utf-8');
    assert.ok(handoff.includes('## Team mode'));
    assert.ok(handoff.includes('Team history'));
    assert.ok(handoff.includes('shared handoff note') || handoff.includes('handoff from backend'));
  } finally {
    process.env.MINDSWAP_TEAM = original;
    console.log = global.console.log;
    teardown();
  }
};
