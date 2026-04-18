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

const program = new Command();

program
  .name('mindswap')
  .description(chalk.bold('mindswap') + ' — Your AI\'s black box recorder.\nAuto-track project state so any AI tool picks up where the last one stopped.')
  .version(pkg.version);

// ─── 1. init ───
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

// ─── 2. checkpoint ───
program
  .command('checkpoint [message]')
  .alias('cp')
  .description('Save a checkpoint of current project state.')
  .option('-t, --task <task>', 'Current task description')
  .option('-b, --blocker <blocker>', 'Current blocker')
  .option('--next <next>', 'What should be done next')
  .option('-c, --check', 'Run tests and capture results in checkpoint')
  .option('--build', 'Also run build check (use with --check)')
  .action(async (message, opts) => {
    try {
      await checkpoint(process.cwd(), message, opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── 3. log ───
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

// ─── 4. status ───
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

// ─── 5. generate ───
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

// ─── 6. done ───
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

// ─── 7. reset ───
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

// ─── 8. watch ───
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

// ─── 9. switch ───
program
  .command('switch <tool>')
  .alias('sw')
  .description('Switch AI tool — checkpoint + generate context + open. Tools: cursor, claude, copilot, codex, windsurf')
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

// ─── 10. summary ───
program
  .command('summary')
  .alias('sum')
  .description('AI-readable session summary — task, decisions, conflicts, stats.')
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
