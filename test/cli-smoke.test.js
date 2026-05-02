const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createTempProject, cleanup, runCli } = require('./helpers');

let dir;
let homeDir;
let hubPath;

function setup() {
  dir = createTempProject('cli-smoke');
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindswap-home-'));
  hubPath = path.join(homeDir, 'sync-hub.json');
}

function teardown() {
  cleanup(dir);
  cleanup(homeDir);
}

function cli(args, opts = {}) {
  return runCli(args, {
    cwd: dir,
    env: {
      HOME: homeDir,
      USERPROFILE: homeDir,
      ...opts.env,
    },
    timeout: opts.timeout || 15000,
  });
}

function assertSuccess(result, context) {
  assert.strictEqual(result.status, 0, `${context}\nSTDERR:\n${result.stderr}\nSTDOUT:\n${result.stdout}`);
}

exports.test_cli_help_covers_all_commands = () => {
  setup();
  try {
    const root = cli(['--help']);
    assertSuccess(root, 'root help should succeed');

    const commands = [
      'save', 'init', 'checkpoint', 'log', 'memory', 'status', 'doctor', 'generate',
      'done', 'reset', 'watch', 'switch', 'pr', 'summary', 'search', 'ask',
      'contracts', 'sync', 'resume', 'reindex', 'mcp', 'mcp-http', 'registry', 'mcp-install',
    ];

    for (const command of commands) {
      const result = cli([command, '--help']);
      assertSuccess(result, `${command} help should succeed`);
      assert.ok(result.stdout.includes(command), `${command} help should mention the command`);
    }
  } finally {
    teardown();
  }
};

exports.test_cli_smoke_executes_all_major_commands = async () => {
  setup();
  try {
    let result = cli(['doctor', '--json']);
    assert.strictEqual(result.status, 1, `doctor before init should report a failing diagnostic state\nSTDERR:\n${result.stderr}\nSTDOUT:\n${result.stdout}`);
    let payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.status, 'failing');
    assert.ok(Array.isArray(payload.checks));
    assert.ok(payload.checks.some(check => check.message.includes('not initialized')));

    result = cli(['init', '--no-hooks']);
    assertSuccess(result, 'init should succeed');
    assert.ok(fs.existsSync(path.join(dir, '.mindswap', 'state.json')));

    result = cli([]);
    assertSuccess(result, 'default save should succeed');

    result = cli(['save', '--message', 'manual save']);
    assertSuccess(result, 'save command should succeed');

    result = cli(['checkpoint', 'checkpoint note', '--task', 'Ship smoke suite', '--next', 'Run commands']);
    assertSuccess(result, 'checkpoint should succeed');

    result = cli(['log', 'Use smoke coverage everywhere', '--type', 'decision', '--tag', 'testing']);
    assertSuccess(result, 'log should succeed');

    result = cli(['memory', 'add', 'Remember', 'this', '--type', 'question', '--tag', 'smoke', '--json']);
    assertSuccess(result, 'memory add should succeed');
    payload = JSON.parse(result.stdout);
    const memoryId = payload.item.id;
    assert.ok(memoryId);

    for (const args of [
      ['memory', 'get', memoryId, '--json'],
      ['memory', 'update', memoryId, 'Updated', 'question', '--status', 'in_progress', '--json'],
      ['memory', 'resolve', memoryId, 'Resolved', 'now', '--json'],
      ['memory', 'archive', memoryId, '--json'],
      ['memory', 'delete', memoryId, '--hard', '--json'],
      ['memory', 'list', '--json'],
    ]) {
      result = cli(args);
      assertSuccess(result, `${args.join(' ')} should succeed`);
    }

    for (const args of [
      ['status', '--json'],
      ['doctor', '--json'],
      ['generate', '--handoff'],
      ['summary', '--json'],
      ['search', 'smoke', '--json'],
      ['ask', 'what did we decide?', '--json'],
      ['contracts', '--json'],
      ['resume', '--json'],
      ['reindex', '--json'],
      ['registry', '--json'],
      ['pr', '--body-only'],
      ['switch', 'codex', '--no-open', '--no-hooks'],
      ['done', 'smoke complete'],
      ['reset'],
    ]) {
      result = cli(args, { timeout: 20000 });
      assertSuccess(result, `${args.join(' ')} should succeed`);
    }

    result = cli(['sync', '--hub', hubPath, '--push', '--json']);
    assertSuccess(result, 'sync push should succeed');
    payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.mode, 'push');

    result = cli(['sync', '--hub', hubPath, '--pull', '--force', '--json']);
    assertSuccess(result, 'sync pull should succeed');
    payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.mode, 'pull');

    result = cli(['sync', '--hub', hubPath, '--json']);
    assertSuccess(result, 'sync status should succeed');
    payload = JSON.parse(result.stdout);
    assert.ok(payload.status);
  } finally {
    teardown();
  }
};

exports.test_cli_watch_starts_and_stops_cleanly = async () => {
  setup();
  try {
    let result = cli(['init', '--no-hooks']);
    assertSuccess(result, 'init should succeed before watch');

    const child = spawn('node', ['/Users/zopdev/mindswap/bin/mindswap.js', 'watch', '--interval', '50', '--no-hooks'], {
      cwd: dir,
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`watch did not start\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`)), 5000);
      const poll = setInterval(() => {
        if (stdout.includes('mindswap watching')) {
          clearTimeout(timeout);
          clearInterval(poll);
          resolve();
        }
      }, 50);
    });

    child.kill('SIGINT');

    const exitCode = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`watch did not exit\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`)), 5000);
      child.on('close', code => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    assert.ok(exitCode === 0 || exitCode === null, `watch should exit cleanly\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  } finally {
    teardown();
  }
};

exports.test_cli_mcp_install_writes_expected_configs = () => {
  setup();
  try {
    for (const projectDir of ['.cursor', '.vscode', '.windsurf', '.cline', '.roo']) {
      fs.mkdirSync(path.join(dir, projectDir), { recursive: true });
    }
    for (const homeSubdir of ['.codex', '.gemini']) {
      fs.mkdirSync(path.join(homeDir, homeSubdir), { recursive: true });
    }

    const result = cli(['mcp-install'], { timeout: 20000 });
    assertSuccess(result, 'mcp-install should succeed');

    const projectConfigs = [
      path.join(dir, '.cursor', 'mcp.json'),
      path.join(dir, '.vscode', 'mcp.json'),
      path.join(dir, '.windsurf', 'mcp.json'),
      path.join(dir, '.cline', 'mcp.json'),
      path.join(dir, '.roo', 'mcp.json'),
    ];
    const homeConfigs = [
      path.join(homeDir, '.claude.json'),
      path.join(homeDir, '.codex', 'config.json'),
      path.join(homeDir, '.gemini', 'settings.json'),
    ];

    for (const configPath of [...projectConfigs, ...homeConfigs]) {
      assert.ok(fs.existsSync(configPath), `${configPath} should be written`);
      const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const servers = content.mcpServers || content.servers;
      assert.ok(servers.mindswap, `${configPath} should contain a mindswap server entry`);
    }
  } finally {
    teardown();
  }
};
