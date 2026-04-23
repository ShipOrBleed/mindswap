const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, writeState, getDefaultState } = require('../src/state');
const { generate, safeWriteContextFile, SECTION_START, SECTION_END } = require('../src/generate');

let dir;
function setup() {
  dir = createTempProject('generate-test');
  ensureDataDir(dir);
  const state = getDefaultState();
  state.project = {
    name: 'test-project', language: 'typescript', framework: 'Express',
    tech_stack: ['node.js', 'express', 'typescript'],
    package_manager: 'npm', test_runner: 'jest',
  };
  state.current_task = {
    description: 'building auth', status: 'in_progress',
    blocker: null, next_steps: ['add refresh tokens'], started_at: '2026-01-01',
  };
  writeState(dir, state);
  fs.writeFileSync(path.join(dir, '.mindswap', 'decisions.log'),
    '# Decisions\n\n[2026-01-01T00:00:00Z] [auth] chose JWT over sessions\n', 'utf-8');
}
function teardown() { cleanup(dir); }

function withFakeHome(homeDir, fn) {
  const original = os.homedir;
  os.homedir = () => homeDir;
  try {
    return fn();
  } finally {
    os.homedir = original;
  }
}

exports.test_generate_creates_handoff_md = async () => {
  setup();
  try {
    console.log = () => {};
    await generate(dir, { handoff: true });
    console.log = global.console.log;

    const handoff = fs.readFileSync(path.join(dir, 'HANDOFF.md'), 'utf-8');
    assert.ok(handoff.includes('test-project'));
    assert.ok(handoff.includes('building auth'));
    assert.ok(handoff.includes('chose JWT'));
  } finally { teardown(); }
};

exports.test_generate_all_creates_all_files = async () => {
  setup();
  try {
    console.log = () => {};
    await generate(dir, { all: true });
    console.log = global.console.log;

    assert.ok(fs.existsSync(path.join(dir, 'HANDOFF.md')));
    assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')));
    assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')));
    assert.ok(fs.existsSync(path.join(dir, '.cursor', 'rules', 'mindswap-context.mdc')));
    assert.ok(fs.existsSync(path.join(dir, '.github', 'copilot-instructions.md')));
  } finally { teardown(); }
};

exports.test_safeWrite_creates_new_file_with_markers = () => {
  setup();
  try {
    const testFile = path.join(dir, 'TEST.md');
    safeWriteContextFile(testFile, 'mindswap content');
    const content = fs.readFileSync(testFile, 'utf-8');
    assert.ok(content.includes(SECTION_START));
    assert.ok(content.includes(SECTION_END));
    assert.ok(content.includes('mindswap content'));
  } finally { teardown(); }
};

exports.test_safeWrite_preserves_existing_content = () => {
  setup();
  try {
    const testFile = path.join(dir, 'EXISTING.md');
    fs.writeFileSync(testFile, '# My Custom Content\n\nDo not delete this.\n');
    safeWriteContextFile(testFile, 'mindswap stuff');
    const content = fs.readFileSync(testFile, 'utf-8');
    assert.ok(content.includes('My Custom Content'));
    assert.ok(content.includes('Do not delete this'));
    assert.ok(content.includes('mindswap stuff'));
  } finally { teardown(); }
};

exports.test_safeWrite_replaces_only_mindswap_section = () => {
  setup();
  try {
    const testFile = path.join(dir, 'MIXED.md');
    const original = `# User Content\n\n${SECTION_START}\nold content\n${SECTION_END}\n\n# More User Content\n`;
    fs.writeFileSync(testFile, original);
    safeWriteContextFile(testFile, 'NEW content');
    const content = fs.readFileSync(testFile, 'utf-8');
    assert.ok(content.includes('User Content'));
    assert.ok(content.includes('More User Content'));
    assert.ok(content.includes('NEW content'));
    assert.ok(!content.includes('old content'));
  } finally { teardown(); }
};

exports.test_generate_claude_does_not_overwrite_existing = async () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My Project Rules\n\nNever use var.\n');
    console.log = () => {};
    await generate(dir, { claude: true });
    console.log = global.console.log;

    const content = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8');
    assert.ok(content.includes('My Project Rules'));
    assert.ok(content.includes('Never use var'));
    assert.ok(content.includes(SECTION_START));
  } finally { teardown(); }
};

exports.test_generate_includes_native_session_summary = async () => {
  setup();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindswap-home-'));
  try {
    const sessionPath = path.join(homeDir, '.claude', 'projects', 'match-1', 'session.jsonl');
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, [
      JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'Blocked on database migration.' }] }),
      JSON.stringify({ role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: path.join(dir, 'src', 'index.js') } }] }),
    ].join('\n'), 'utf-8');

    console.log = () => {};
    await withFakeHome(homeDir, () => generate(dir, { handoff: true }));
    console.log = global.console.log;

    const handoff = fs.readFileSync(path.join(dir, 'HANDOFF.md'), 'utf-8');
    assert.ok(handoff.includes('Recent AI sessions'));
    assert.ok(handoff.includes('Blocked on database migration'));
  } finally {
    console.log = global.console.log;
    teardown();
    cleanup(homeDir);
  }
};
