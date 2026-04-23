const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, getDefaultState, writeState, readState } = require('../src/state');
const { resume, buildResumeBriefing, gatherResumeData, recommendNextAction } = require('../src/resume');

let dir;

function setup() {
  dir = createTempProject('resume-test');
  ensureDataDir(dir);
  fs.writeFileSync(path.join(dir, '.mindswap', 'decisions.log'), '[2026-04-23T00:00:00Z] [auth] chose JWT over sessions\n', 'utf-8');
}

function teardown() {
  cleanup(dir);
}

function seedState(overrides = {}) {
  const state = getDefaultState();
  state.project = {
    name: 'resume-app',
    language: 'javascript',
    framework: 'Express',
    tech_stack: ['node.js', 'express'],
    package_manager: 'npm',
  };
  state.current_task = {
    description: 'ship auth middleware',
    status: 'in_progress',
    blocker: null,
    next_steps: ['wire token refresh'],
    started_at: new Date().toISOString(),
  };
  state.last_checkpoint = {
    timestamp: new Date().toISOString(),
    message: 'saved checkpoint',
    ai_tool: 'Codex',
  };
  Object.assign(state, overrides);
  writeState(dir, state);
}

exports.test_buildResumeBriefing_includes_state_and_recommendation = () => {
  setup();
  try {
    seedState();
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'auth.js'), 'module.exports = {};\n', 'utf-8');

    const briefing = buildResumeBriefing(readState(dir), gatherResumeData(dir));
    assert.ok(briefing.stateLines.some(line => line.includes('Task: ship auth middleware')));
    assert.ok(briefing.stateLines.some(line => line.includes('Uncommitted changes:')));
    assert.ok(briefing.recommendation.summary.length > 0);
    assert.ok(briefing.recommendation.command);
  } finally {
    teardown();
  }
};

exports.test_recommendNextAction_prefers_blocker = () => {
  setup();
  try {
    seedState({
      current_task: {
        description: 'ship auth middleware',
        status: 'blocked',
        blocker: 'waiting on token refresh behavior',
        next_steps: [],
      },
    });
    const recommendation = recommendNextAction(readState(dir), {
      branch: 'main',
      changedFiles: [],
      recentCommits: [],
      history: [],
      nativeSessions: [],
      decisions: [],
      structuredMemory: [],
      blockers: [],
      questions: [],
      conflicts: [],
      depConflicts: [],
    }, { score: 100, missing: [] });
    assert.ok(recommendation.summary.includes('Resolve the active blocker'));
    assert.strictEqual(recommendation.command, 'npx mindswap status');
  } finally {
    teardown();
  }
};

exports.test_resume_outputs_text_and_json = async () => {
  setup();
  try {
    seedState();
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'auth.js'), 'module.exports = {};\n', 'utf-8');

    const originalLog = console.log;
    const lines = [];
    console.log = (...args) => {
      lines.push(args.join(' '));
    };

    try {
      await resume(dir, {});
      assert.ok(lines.join('\n').includes('Resume Briefing'));
      lines.length = 0;
      await resume(dir, { json: true });
      const parsed = JSON.parse(lines.join('\n'));
      assert.ok(parsed.state);
      assert.ok(parsed.recommendation);
    } finally {
      console.log = originalLog;
    }
  } finally {
    teardown();
  }
};
