const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir } = require('../src/state');
const { log } = require('../src/decisions');

let dir;
function setup() {
  dir = createTempProject('decisions-test');
  ensureDataDir(dir);
  fs.writeFileSync(path.join(dir, '.mindswap', 'decisions.log'), '# Decision Log\n\n', 'utf-8');
  fs.writeFileSync(path.join(dir, '.mindswap', 'state.json'), JSON.stringify({
    version: '1.0.0',
    project: { name: 'test', tech_stack: [], package_manager: 'npm' },
    current_task: { description: '', status: 'idle', next_steps: [] },
    last_checkpoint: {}, modified_files: [],
  }), 'utf-8');
}
function teardown() { cleanup(dir); }

exports.test_log_appends_to_decisions_file = async () => {
  setup();
  try {
    console.log = () => {};
    await log(dir, 'chose Redis for caching', { tag: 'architecture' });
    console.log = global.console.log;

    const content = fs.readFileSync(path.join(dir, '.mindswap', 'decisions.log'), 'utf-8');
    assert.ok(content.includes('chose Redis for caching'));
    assert.ok(content.includes('[architecture]'));
  } finally { teardown(); }
};

exports.test_log_uses_default_tag = async () => {
  setup();
  try {
    console.log = () => {};
    await log(dir, 'some decision', {});
    console.log = global.console.log;

    const content = fs.readFileSync(path.join(dir, '.mindswap', 'decisions.log'), 'utf-8');
    assert.ok(content.includes('[general]'));
  } finally { teardown(); }
};

exports.test_log_includes_timestamp = async () => {
  setup();
  try {
    console.log = () => {};
    await log(dir, 'timestamped decision', {});
    console.log = global.console.log;

    const content = fs.readFileSync(path.join(dir, '.mindswap', 'decisions.log'), 'utf-8');
    assert.ok(content.match(/\[\d{4}-\d{2}-\d{2}T/));
  } finally { teardown(); }
};

exports.test_multiple_logs_accumulate = async () => {
  setup();
  try {
    console.log = () => {};
    await log(dir, 'decision one', { tag: 'db' });
    await log(dir, 'decision two', { tag: 'api' });
    await log(dir, 'decision three', { tag: 'auth' });
    console.log = global.console.log;

    const content = fs.readFileSync(path.join(dir, '.mindswap', 'decisions.log'), 'utf-8');
    const entries = content.split('\n').filter(l => l.startsWith('['));
    assert.strictEqual(entries.length, 3);
  } finally { teardown(); }
};

exports.test_log_detects_conflicts = async () => {
  setup();
  try {
    let output = '';
    console.log = (msg) => { output += (msg || '') + '\n'; };
    await log(dir, 'using Redis for caching', { tag: 'db' });
    await log(dir, 'NOT using Redis', { tag: 'db' });
    console.log = global.console.log;

    assert.ok(output.includes('conflict') || output.includes('Conflict') || output.includes('Contradiction'),
      'should warn about conflict');
  } finally { teardown(); }
};
