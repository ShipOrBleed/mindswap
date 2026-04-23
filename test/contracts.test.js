const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, getDefaultState, writeState, addToHistory } = require('../src/state');
const { appendMemoryItem } = require('../src/memory');
const { buildContracts, contracts } = require('../src/contracts');

let dir;

function setup() {
  dir = createTempProject('contracts-test');
  ensureDataDir(dir);

  const state = getDefaultState();
  state.project = {
    name: 'contracts-app',
    language: 'typescript',
    framework: 'Express',
    tech_stack: ['node.js', 'express'],
    package_manager: 'npm',
  };
  state.current_task = {
    description: 'ship auth middleware',
    status: 'in_progress',
    blocker: 'waiting on session review',
    next_steps: ['wire token refresh'],
    started_at: new Date().toISOString(),
  };
  writeState(dir, state);

  fs.writeFileSync(path.join(dir, '.mindswap', 'decisions.log'), [
    '[2026-04-23T00:00:00Z] [auth] chose JWT over sessions',
    '[2026-04-23T00:00:01Z] [api] keep handlers thin',
  ].join('\n') + '\n', 'utf-8');

  addToHistory(dir, {
    timestamp: '2026-04-23T01:00:00.000Z',
    message: 'updated auth middleware contract',
    ai_tool: 'Codex',
  });

  appendMemoryItem(dir, {
    type: 'assumption',
    tag: 'auth',
    message: 'JWT remains stateless for v1',
  });

  appendMemoryItem(dir, {
    type: 'question',
    tag: 'auth',
    message: 'Do we need refresh token rotation?',
  });

  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'api-handler.js'), 'module.exports = {};\n', 'utf-8');
}

function teardown() {
  cleanup(dir);
}

exports.test_buildContracts_includes_workstream_and_memory = () => {
  setup();
  try {
    const payload = buildContracts(dir);
    assert.strictEqual(payload.version, '1.0.0');
    assert.ok(payload.project.branch);
    assert.ok(Array.isArray(payload.contracts));
    assert.strictEqual(payload.contracts.length, 1);

    const contract = payload.contracts[0];
    assert.strictEqual(contract.id, 'current-workstream');
    assert.ok(contract.boundaries.length > 0);
    assert.ok(contract.inputs.length > 0);
    assert.ok(contract.outputs.length > 0);
    assert.ok(contract.blockers.some(item => item.includes('waiting on session review')));
    assert.ok(contract.assumptions.some(item => item.includes('stateless')));
    assert.ok(contract.open_questions.some(item => item.includes('refresh token rotation')));
    assert.ok(contract.changed_files.some(item => item.file.includes('api-handler.js')));
  } finally {
    teardown();
  }
};

exports.test_contracts_writes_json_files = async () => {
  setup();
  try {
    const originalLog = console.log;
    const lines = [];
    console.log = (...args) => {
      lines.push(args.join(' '));
    };

    try {
      await contracts(dir, {});
    } finally {
      console.log = originalLog;
    }

    const dataDir = path.join(dir, '.mindswap');
    const written = JSON.parse(fs.readFileSync(path.join(dataDir, 'contracts.json'), 'utf-8'));
    assert.strictEqual(written.contracts[0].id, 'current-workstream');
    assert.ok(fs.existsSync(path.join(dir, 'CONTRACTS.json')));
    assert.ok(lines.join('\n').includes('current-workstream') || lines.length > 0);
  } finally {
    teardown();
  }
};
