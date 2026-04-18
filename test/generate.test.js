const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureRelayDir, writeState, getDefaultState } = require('../src/state');
const { generate, safeWriteContextFile, RELAY_SECTION_START, RELAY_SECTION_END } = require('../src/generate');

let dir;

function setup() {
  dir = createTempProject('generate-test');
  ensureRelayDir(dir);
  const state = getDefaultState();
  state.project = {
    name: 'test-project',
    language: 'typescript',
    framework: 'Express',
    tech_stack: ['node.js', 'express', 'typescript'],
    package_manager: 'npm',
    test_runner: 'jest',
  };
  state.current_task = {
    description: 'building auth',
    status: 'in_progress',
    blocker: null,
    next_steps: ['add refresh tokens'],
    started_at: '2026-01-01',
  };
  writeState(dir, state);
  // Create decisions log
  fs.writeFileSync(
    path.join(dir, '.relay', 'decisions.log'),
    '# Decisions\n\n[2026-01-01T00:00:00Z] [auth] chose JWT over sessions\n',
    'utf-8'
  );
}

function teardown() {
  cleanup(dir);
}

exports.test_generate_creates_handoff_md = async () => {
  setup();
  try {
    const origLog = console.log;
    console.log = () => {};
    await generate(dir, { handoff: true });
    console.log = origLog;

    const handoff = fs.readFileSync(path.join(dir, 'HANDOFF.md'), 'utf-8');
    assert.ok(handoff.includes('test-project'), 'should include project name');
    assert.ok(handoff.includes('building auth'), 'should include current task');
    assert.ok(handoff.includes('chose JWT'), 'should include decisions');
  } finally {
    teardown();
  }
};

exports.test_generate_creates_relay_dir_handoff = async () => {
  setup();
  try {
    const origLog = console.log;
    console.log = () => {};
    await generate(dir, { handoff: true });
    console.log = origLog;

    assert.ok(
      fs.existsSync(path.join(dir, '.relay', 'HANDOFF.md')),
      'should create .relay/HANDOFF.md'
    );
  } finally {
    teardown();
  }
};

exports.test_generate_all_creates_all_files = async () => {
  setup();
  try {
    const origLog = console.log;
    console.log = () => {};
    await generate(dir, { all: true });
    console.log = origLog;

    assert.ok(fs.existsSync(path.join(dir, 'HANDOFF.md')), 'HANDOFF.md');
    assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')), 'AGENTS.md');
    assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')), 'CLAUDE.md');
    assert.ok(fs.existsSync(path.join(dir, '.cursor', 'rules', 'relay-context.mdc')), '.cursor/rules');
    assert.ok(fs.existsSync(path.join(dir, '.github', 'copilot-instructions.md')), 'copilot-instructions');
  } finally {
    teardown();
  }
};

exports.test_safeWrite_creates_new_file_with_markers = () => {
  setup();
  try {
    const testFile = path.join(dir, 'TEST.md');
    safeWriteContextFile(testFile, 'relay content here', 'TEST.md');

    const content = fs.readFileSync(testFile, 'utf-8');
    assert.ok(content.includes(RELAY_SECTION_START), 'should have start marker');
    assert.ok(content.includes(RELAY_SECTION_END), 'should have end marker');
    assert.ok(content.includes('relay content here'), 'should have content');
  } finally {
    teardown();
  }
};

exports.test_safeWrite_preserves_existing_content = () => {
  setup();
  try {
    const testFile = path.join(dir, 'EXISTING.md');
    fs.writeFileSync(testFile, '# My Custom Content\n\nDo not delete this.\n');

    safeWriteContextFile(testFile, 'relay stuff', 'EXISTING.md');

    const content = fs.readFileSync(testFile, 'utf-8');
    assert.ok(content.includes('My Custom Content'), 'should preserve original content');
    assert.ok(content.includes('Do not delete this'), 'should preserve original content');
    assert.ok(content.includes('relay stuff'), 'should append relay content');
    assert.ok(content.includes(RELAY_SECTION_START), 'should have start marker');
  } finally {
    teardown();
  }
};

exports.test_safeWrite_replaces_only_relay_section = () => {
  setup();
  try {
    const testFile = path.join(dir, 'MIXED.md');
    const original = `# User Content\n\nImportant stuff.\n\n${RELAY_SECTION_START}\nold relay content\n${RELAY_SECTION_END}\n\n# More User Content\n`;
    fs.writeFileSync(testFile, original);

    safeWriteContextFile(testFile, 'NEW relay content', 'MIXED.md');

    const content = fs.readFileSync(testFile, 'utf-8');
    assert.ok(content.includes('User Content'), 'should preserve user content before');
    assert.ok(content.includes('More User Content'), 'should preserve user content after');
    assert.ok(content.includes('NEW relay content'), 'should have new relay content');
    assert.ok(!content.includes('old relay content'), 'should not have old relay content');
  } finally {
    teardown();
  }
};

exports.test_generate_claude_does_not_overwrite_existing = async () => {
  setup();
  try {
    // Write a user's existing CLAUDE.md
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My Project Rules\n\nNever use var.\n');

    const origLog = console.log;
    console.log = () => {};
    await generate(dir, { claude: true });
    console.log = origLog;

    const content = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf-8');
    assert.ok(content.includes('My Project Rules'), 'should preserve user content');
    assert.ok(content.includes('Never use var'), 'should preserve user rules');
    assert.ok(content.includes(RELAY_SECTION_START), 'should have relay section');
  } finally {
    teardown();
  }
};
