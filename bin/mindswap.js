#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const pkg = require('../package.json');

const { init } = require('../src/init');
const { checkpoint } = require('../src/checkpoint');
const { status } = require('../src/status');
const { generate } = require('../src/generate');
const { watch } = require('../src/watch');
const { log } = require('../src/decisions');
const { done, reset } = require('../src/lifecycle');
const { switchTool } = require('../src/switch');
const { summary } = require('../src/summary');
const { save } = require('../src/save');
const { pr } = require('../src/pr');
const { startMCPServer } = require('../src/mcp-server');

const program = new Command();

// ─── Early intercept for MCP (must run before commander parses) ───
// Commander's isDefault on save can interfere with mcp subcommand in pipe contexts
const rawArgs = process.argv.slice(2);
if (rawArgs[0] === 'mcp' && rawArgs.length === 1) {
  startMCPServer().catch(err => {
    process.stderr.write(`mindswap MCP error: ${err.message}\n`);
    process.exit(1);
  });
} else {

program
  .name('mindswap')
  .description(chalk.bold('mindswap') + ' — Your AI\'s black box recorder.\nAuto-track project state so any AI tool picks up where the last one stopped.\n\nJust run ' + chalk.cyan('mindswap') + ' to save everything. That\'s it.')
  .version(pkg.version);

// ─── DEFAULT: save (runs when you just type `mindswap`) ───
program
  .command('save', { isDefault: true })
  .description('THE one command. Auto-detects task, deps, state — generates all context files. Just run `mindswap`.')
  .option('-m, --message <msg>', 'Optional message (auto-detected if omitted)')
  .option('-c, --check', 'Also run tests and capture results')
  .option('-q, --quiet', 'No output (used by git hooks)')
  .action(async (opts) => {
    try {
      await save(process.cwd(), opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── init ───
program
  .command('init')
  .description('Initialize mindswap. Auto-detects stack, imports existing AI context files.')
  .option('--no-hooks', 'Skip installing git hooks')
  .action(async (opts) => {
    try {
      await init(process.cwd(), opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── checkpoint (power user) ───
program
  .command('checkpoint [message]')
  .alias('cp')
  .description('Manual checkpoint with custom task/blocker/next flags.')
  .option('-t, --task <task>', 'Current task description')
  .option('-b, --blocker <blocker>', 'Current blocker')
  .option('--next <next>', 'What should be done next')
  .option('-c, --check', 'Run tests and capture results')
  .option('--build', 'Also run build check')
  .action(async (message, opts) => {
    try {
      await checkpoint(process.cwd(), message, opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── log ───
program
  .command('log <message>')
  .alias('l')
  .description('Log a decision. Warns if it conflicts with existing decisions.')
  .option('--tag <tag>', 'Tag (e.g., architecture, database, auth)')
  .action(async (message, opts) => {
    try {
      await log(process.cwd(), message, opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── status ───
program
  .command('status')
  .alias('s')
  .description('Show current state — task, branch, build/test, conflicts.')
  .option('--json', 'Output as JSON')
  .option('--stats', 'Include session statistics')
  .action(async (opts) => {
    try {
      await status(process.cwd(), opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── generate ───
program
  .command('generate')
  .alias('gen')
  .description('Generate AI context files. Safe-merges with existing files.')
  .option('-a, --all', 'Generate for all AI tools')
  .option('--claude', 'Generate CLAUDE.md')
  .option('--cursor', 'Generate .cursor/rules')
  .option('--copilot', 'Generate copilot-instructions.md')
  .option('--agents', 'Generate AGENTS.md')
  .option('--handoff', 'Generate HANDOFF.md only (default)')
  .option('--compact', 'Token-optimized minimal output')
  .option('--gemini', 'Generate GEMINI.md')
  .option('--windsurf', 'Generate .windsurfrules')
  .option('--cline', 'Generate .cline/ rules')
  .option('--roo', 'Generate .roo/ rules')
  .option('--aider', 'Generate CONVENTIONS.md')
  .option('--amp', 'Generate .amp/ rules')
  .option('--codex', 'Generate CODEX.md')
  .action(async (opts) => {
    try {
      await generate(process.cwd(), opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── done ───
program
  .command('done [message]')
  .alias('d')
  .description('Mark current task as completed and archive it.')
  .action(async (message) => {
    try {
      await done(process.cwd(), message);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── reset ───
program
  .command('reset')
  .alias('r')
  .description('Clear current task. Decisions and history preserved by default.')
  .option('-f, --full', 'Also clear decisions log')
  .action(async (opts) => {
    try {
      await reset(process.cwd(), opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── watch ───
program
  .command('watch')
  .alias('w')
  .description('Watch for file changes and auto-update HANDOFF.md.')
  .option('-i, --interval <ms>', 'Debounce interval in ms', '2000')
  .option('--all', 'Refresh all generated context files on each change')
  .option('--save', 'Run a full save cycle on each change')
  .option('--tool <tool>', 'Associate watcher lifecycle with a specific AI tool')
  .option('-m, --message <msg>', 'Session note for automatic watcher start/end saves')
  .option('--no-hooks', 'Skip automatic session start/end hooks')
  .action(async (opts) => {
    try {
      await watch(process.cwd(), opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── switch ───
program
  .command('switch <tool>')
  .alias('sw')
  .description('Switch AI tool — save + generate context + open. Tools: cursor, claude, copilot, codex, windsurf')
  .option('-m, --message <msg>', 'Checkpoint message')
  .option('--from <tool>', 'Override the current tool for the session-end hook')
  .option('--no-hooks', 'Skip automatic session start/end hooks')
  .option('--no-open', 'Don\'t try to open the tool')
  .action(async (tool, opts) => {
    try {
      await switchTool(process.cwd(), tool, opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── pr ───
program
  .command('pr')
  .description('Add mindswap context to GitHub PR. Updates existing PR or shows context to add.')
  .option('--body-only', 'Output only the context body (for piping)')
  .action(async (opts) => {
    try {
      await pr(process.cwd(), opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── summary ───
program
  .command('summary')
  .alias('sum')
  .description('Full session narrative — task, decisions, conflicts, stats.')
  .option('--json', 'Output as JSON')
  .option('--stats', 'Include detailed statistics')
  .option('--tag <tag>', 'Filter decisions by tag (e.g., --tag architecture)')
  .action(async (opts) => {
    try {
      await summary(process.cwd(), opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── mcp ───
program
  .command('mcp')
  .description('Start mindswap as an MCP server (stdio transport). Used by AI tools, not humans.')
  .action(async () => {
    try {
      await startMCPServer();
    } catch (err) {
      process.stderr.write(`mindswap MCP error: ${err.message}\n`);
      process.exit(1);
    }
  });

// ─── mcp install ───
program
  .command('mcp-install')
  .description('Auto-configure mindswap MCP server for Claude Code and Cursor.')
  .action(async () => {
    try {
      await installMCP();
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

program.parse();

} // end of else block (non-MCP commands)

async function installMCP() {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const mindswapPath = process.argv[1]; // Path to this CLI binary
  const npxCmd = 'npx';

  console.log(chalk.bold('\n⚡ Installing mindswap MCP server\n'));

  const mcpEntry = { type: 'stdio', command: npxCmd, args: ['mindswap', 'mcp'] };
  let configured = 0;

  // Claude Code — always configure (global config, doesn't create project dirs)
  const claudeConfigPath = path.join(os.homedir(), '.claude.json');
  let claudeConfig = {};
  if (fs.existsSync(claudeConfigPath)) {
    try { claudeConfig = JSON.parse(fs.readFileSync(claudeConfigPath, 'utf-8')); } catch {}
  }
  if (!claudeConfig.mcpServers) claudeConfig.mcpServers = {};
  claudeConfig.mcpServers.mindswap = mcpEntry;
  fs.writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2), 'utf-8');
  console.log(chalk.green('  ✓ ') + 'Claude Code — ~/.claude.json');
  configured++;

  // Cursor — only if .cursor/ already exists in this project
  const cursorDir = path.join(process.cwd(), '.cursor');
  if (fs.existsSync(cursorDir)) {
    const cursorConfigPath = path.join(cursorDir, 'mcp.json');
    let cursorConfig = {};
    if (fs.existsSync(cursorConfigPath)) {
      try { cursorConfig = JSON.parse(fs.readFileSync(cursorConfigPath, 'utf-8')); } catch {}
    }
    if (!cursorConfig.mcpServers) cursorConfig.mcpServers = {};
    cursorConfig.mcpServers.mindswap = mcpEntry;
    fs.writeFileSync(cursorConfigPath, JSON.stringify(cursorConfig, null, 2), 'utf-8');
    console.log(chalk.green('  ✓ ') + 'Cursor — .cursor/mcp.json');
    configured++;
  } else {
    console.log(chalk.dim('  ○ ') + 'Cursor — skipped (no .cursor/ directory)');
  }

  // VS Code — only if .vscode/ already exists in this project
  const vscodeDir = path.join(process.cwd(), '.vscode');
  if (fs.existsSync(vscodeDir)) {
    const vscodeConfigPath = path.join(vscodeDir, 'mcp.json');
    let vscodeConfig = {};
    if (fs.existsSync(vscodeConfigPath)) {
      try { vscodeConfig = JSON.parse(fs.readFileSync(vscodeConfigPath, 'utf-8')); } catch {}
    }
    if (!vscodeConfig.servers) vscodeConfig.servers = {};
    vscodeConfig.servers.mindswap = mcpEntry;
    fs.writeFileSync(vscodeConfigPath, JSON.stringify(vscodeConfig, null, 2), 'utf-8');
    console.log(chalk.green('  ✓ ') + 'VS Code / Copilot — .vscode/mcp.json');
    configured++;
  } else {
    console.log(chalk.dim('  ○ ') + 'VS Code — skipped (no .vscode/ directory)');
  }

  // Windsurf — only if .windsurf/ exists
  const windsurfDir = path.join(process.cwd(), '.windsurf');
  if (fs.existsSync(windsurfDir)) {
    const wsConfigPath = path.join(windsurfDir, 'mcp.json');
    let wsConfig = {};
    if (fs.existsSync(wsConfigPath)) {
      try { wsConfig = JSON.parse(fs.readFileSync(wsConfigPath, 'utf-8')); } catch {}
    }
    if (!wsConfig.mcpServers) wsConfig.mcpServers = {};
    wsConfig.mcpServers.mindswap = mcpEntry;
    fs.writeFileSync(wsConfigPath, JSON.stringify(wsConfig, null, 2), 'utf-8');
    console.log(chalk.green('  ✓ ') + 'Windsurf — .windsurf/mcp.json');
    configured++;
  } else {
    console.log(chalk.dim('  ○ ') + 'Windsurf — skipped (no .windsurf/ directory)');
  }

  // Cline — VS Code extension, uses .cline/mcp.json or cline_mcp_settings.json
  const clineDir = path.join(process.cwd(), '.cline');
  if (fs.existsSync(clineDir)) {
    const clineConfigPath = path.join(clineDir, 'mcp.json');
    let clineConfig = {};
    if (fs.existsSync(clineConfigPath)) {
      try { clineConfig = JSON.parse(fs.readFileSync(clineConfigPath, 'utf-8')); } catch {}
    }
    if (!clineConfig.mcpServers) clineConfig.mcpServers = {};
    clineConfig.mcpServers.mindswap = mcpEntry;
    fs.writeFileSync(clineConfigPath, JSON.stringify(clineConfig, null, 2), 'utf-8');
    console.log(chalk.green('  ✓ ') + 'Cline — .cline/mcp.json');
    configured++;
  } else {
    console.log(chalk.dim('  ○ ') + 'Cline — skipped (no .cline/ directory)');
  }

  // Roo Code — uses .roo/mcp.json
  const rooDir = path.join(process.cwd(), '.roo');
  if (fs.existsSync(rooDir)) {
    const rooConfigPath = path.join(rooDir, 'mcp.json');
    let rooConfig = {};
    if (fs.existsSync(rooConfigPath)) {
      try { rooConfig = JSON.parse(fs.readFileSync(rooConfigPath, 'utf-8')); } catch {}
    }
    if (!rooConfig.mcpServers) rooConfig.mcpServers = {};
    rooConfig.mcpServers.mindswap = mcpEntry;
    fs.writeFileSync(rooConfigPath, JSON.stringify(rooConfig, null, 2), 'utf-8');
    console.log(chalk.green('  ✓ ') + 'Roo Code — .roo/mcp.json');
    configured++;
  } else {
    console.log(chalk.dim('  ○ ') + 'Roo Code — skipped (no .roo/ directory)');
  }

  // Codex CLI — uses ~/.codex/config.json
  const codexDir = path.join(os.homedir(), '.codex');
  if (fs.existsSync(codexDir)) {
    const codexConfigPath = path.join(codexDir, 'config.json');
    let codexConfig = {};
    if (fs.existsSync(codexConfigPath)) {
      try { codexConfig = JSON.parse(fs.readFileSync(codexConfigPath, 'utf-8')); } catch {}
    }
    if (!codexConfig.mcpServers) codexConfig.mcpServers = {};
    codexConfig.mcpServers.mindswap = mcpEntry;
    fs.writeFileSync(codexConfigPath, JSON.stringify(codexConfig, null, 2), 'utf-8');
    console.log(chalk.green('  ✓ ') + 'Codex CLI — ~/.codex/config.json');
    configured++;
  } else {
    console.log(chalk.dim('  ○ ') + 'Codex CLI — skipped (no ~/.codex/ directory)');
  }

  // Gemini CLI — uses ~/.gemini/config.json
  const geminiDir = path.join(os.homedir(), '.gemini');
  if (fs.existsSync(geminiDir)) {
    const geminiConfigPath = path.join(geminiDir, 'settings.json');
    let geminiConfig = {};
    if (fs.existsSync(geminiConfigPath)) {
      try { geminiConfig = JSON.parse(fs.readFileSync(geminiConfigPath, 'utf-8')); } catch {}
    }
    if (!geminiConfig.mcpServers) geminiConfig.mcpServers = {};
    geminiConfig.mcpServers.mindswap = mcpEntry;
    fs.writeFileSync(geminiConfigPath, JSON.stringify(geminiConfig, null, 2), 'utf-8');
    console.log(chalk.green('  ✓ ') + 'Gemini CLI — ~/.gemini/settings.json');
    configured++;
  } else {
    console.log(chalk.dim('  ○ ') + 'Gemini CLI — skipped (no ~/.gemini/ directory)');
  }

  console.log(chalk.bold.green(`\n✓ MCP server configured for ${configured} tool${configured > 1 ? 's' : ''}!\n`));
  console.log(chalk.dim('  3 tools available to AI:'));
  console.log(chalk.white('    mindswap_get_context  ') + chalk.dim('— "What do I need to know?"'));
  console.log(chalk.white('    mindswap_save_context ') + chalk.dim('— "Here\'s what I did"'));
  console.log(chalk.white('    mindswap_search       ') + chalk.dim('— "What did we decide about X?"'));
  console.log(chalk.dim('\n  Restart your AI tool to activate.\n'));
}
