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

const program = new Command();

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
  .option('--no-open', 'Don\'t try to open the tool')
  .action(async (tool, opts) => {
    try {
      await switchTool(process.cwd(), tool, opts);
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
  .action(async (opts) => {
    try {
      await summary(process.cwd(), opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

program.parse();
