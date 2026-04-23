const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir } = require('../src/state');
const { analyzeGuardrails, buildGuardrailSection } = require('../src/guardrails');

let dir;

function setup() {
  dir = createTempProject('guardrails-test');
  ensureDataDir(dir);
}

function teardown() {
  cleanup(dir);
}

exports.test_analyzeGuardrails_flags_session_drift = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, '.mindswap', 'decisions.log'), [
      '[2026-04-23T00:00:00Z] [auth] chose JWT over sessions',
      '[2026-04-23T00:00:01Z] [auth] not using sessions for login flow',
    ].join('\n') + '\n', 'utf-8');

    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'session-store.js'), 'module.exports = { sessionStore: true };\n', 'utf-8');

    const guardrails = analyzeGuardrails(dir);
    assert.ok(guardrails.warnings.length > 0, 'should detect drift warning');
    assert.ok(guardrails.warnings.some(warning => warning.reason.toLowerCase().includes('session')));
    assert.ok(buildGuardrailSection(guardrails).includes('drift signal'));
  } finally {
    teardown();
  }
};

exports.test_analyzeGuardrails_is_quiet_when_surface_matches_no_rejected_terms = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, '.mindswap', 'decisions.log'), [
      '[2026-04-23T00:00:00Z] [db] chose Postgres over SQLite',
    ].join('\n') + '\n', 'utf-8');

    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'postgres-client.js'), 'module.exports = { postgres: true };\n', 'utf-8');

    const guardrails = analyzeGuardrails(dir);
    assert.strictEqual(guardrails.warnings.length, 0);
  } finally {
    teardown();
  }
};
