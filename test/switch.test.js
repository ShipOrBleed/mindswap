const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, getDefaultState, writeState, getHistory } = require('../src/state');
const { switchTool, getHookCommand } = require('../src/switch');

let dir;

function hookCommand() {
  const script = [
    "const fs = require('fs');",
    "const path = require('path');",
    "const line = [process.env.MINDSWAP_EVENT, process.env.MINDSWAP_TOOL, process.env.MINDSWAP_TRIGGER].join(':') + '\\n';",
    "fs.appendFileSync(path.join(process.env.MINDSWAP_PROJECT_ROOT, 'hook.log'), line);",
  ].join(' ');
  return `node -e ${JSON.stringify(script)}`;
}

function setup() {
  dir = createTempProject('switch-test');
  ensureDataDir(dir);
  const state = getDefaultState();
  state.project = { name: 'test-project', tech_stack: ['node.js'], package_manager: 'npm' };
  state.last_checkpoint.ai_tool = 'Claude Code';
  writeState(dir, state);
  fs.writeFileSync(path.join(dir, '.mindswap', 'decisions.log'), '# Decisions\n\n', 'utf-8');
  fs.writeFileSync(path.join(dir, '.mindswap', 'config.json'), JSON.stringify({
    session_hooks: {
      session_start: hookCommand(),
      session_end: hookCommand(),
    },
  }, null, 2));
}

function teardown() {
  cleanup(dir);
}

exports.test_getHookCommand_prefers_tool_specific_hook = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, '.mindswap', 'config.json'), JSON.stringify({
      session_hooks: {
        session_start: 'echo global',
        tools: {
          cursor: {
            session_start: 'echo tool-specific',
          },
        },
      },
    }, null, 2));

    assert.strictEqual(getHookCommand(dir, 'cursor', 'session_start'), 'echo tool-specific');
    assert.strictEqual(getHookCommand(dir, 'claude', 'session_start'), 'echo global');
  } finally {
    teardown();
  }
};

exports.test_switchTool_runs_session_end_and_start_hooks = async () => {
  setup();
  try {
    console.log = () => {};
    await switchTool(dir, 'cursor', { from: 'claude', noOpen: true });
    console.log = global.console.log;

    const hookLog = fs.readFileSync(path.join(dir, 'hook.log'), 'utf-8').trim().split('\n');
    assert.deepStrictEqual(hookLog, [
      'session_end:claude:switch',
      'session_start:cursor:switch',
    ]);

    assert.ok(fs.existsSync(path.join(dir, '.cursor', 'rules', 'mindswap-context.mdc')));

    const history = getHistory(dir, 10);
    const eventTypes = history.map(entry => entry.type);
    assert.ok(eventTypes.includes('session_end'));
    assert.ok(eventTypes.includes('session_start'));
  } finally {
    console.log = global.console.log;
    teardown();
  }
};
