const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureRelayDir } = require('../src/state');
const { log } = require('../src/decisions');

let dir;

function setup() {
  dir = createTempProject('decisions-test');
  ensureRelayDir(dir);
  // Create initial decisions log
  fs.writeFileSync(
    path.join(dir, '.relay', 'decisions.log'),
    '# Decision Log\n\n',
    'utf-8'
  );
  // Need state.json for generate
  fs.writeFileSync(
    path.join(dir, '.relay', 'state.json'),
    JSON.stringify({
      version: '0.1.0',
      project: { name: 'test', tech_stack: [], package_manager: 'npm' },
      current_task: { description: '', status: 'idle', next_steps: [] },
      last_checkpoint: {},
      modified_files: [],
    }),
    'utf-8'
  );
}

function teardown() {
  cleanup(dir);
}

exports.test_log_appends_to_decisions_file = async () => {
  setup();
  try {
    // Suppress console output
    const origLog = console.log;
    console.log = () => {};
    await log(dir, 'chose Redis for caching', { tag: 'architecture' });
    console.log = origLog;

    const content = fs.readFileSync(path.join(dir, '.relay', 'decisions.log'), 'utf-8');
    assert.ok(content.includes('chose Redis for caching'), 'should contain the decision');
    assert.ok(content.includes('[architecture]'), 'should contain the tag');
  } finally {
    teardown();
  }
};

exports.test_log_uses_default_tag = async () => {
  setup();
  try {
    const origLog = console.log;
    console.log = () => {};
    await log(dir, 'some decision', {});
    console.log = origLog;

    const content = fs.readFileSync(path.join(dir, '.relay', 'decisions.log'), 'utf-8');
    assert.ok(content.includes('[general]'), 'should use "general" as default tag');
  } finally {
    teardown();
  }
};

exports.test_log_includes_timestamp = async () => {
  setup();
  try {
    const origLog = console.log;
    console.log = () => {};
    await log(dir, 'timestamped decision', {});
    console.log = origLog;

    const content = fs.readFileSync(path.join(dir, '.relay', 'decisions.log'), 'utf-8');
    // ISO timestamp pattern
    assert.ok(content.match(/\[\d{4}-\d{2}-\d{2}T/), 'should contain ISO timestamp');
  } finally {
    teardown();
  }
};

exports.test_multiple_logs_accumulate = async () => {
  setup();
  try {
    const origLog = console.log;
    console.log = () => {};
    await log(dir, 'decision one', { tag: 'db' });
    await log(dir, 'decision two', { tag: 'api' });
    await log(dir, 'decision three', { tag: 'auth' });
    console.log = origLog;

    const content = fs.readFileSync(path.join(dir, '.relay', 'decisions.log'), 'utf-8');
    const entries = content.split('\n').filter(l => l.startsWith('['));
    assert.strictEqual(entries.length, 3, `expected 3 entries, got ${entries.length}`);
  } finally {
    teardown();
  }
};
