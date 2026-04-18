#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const path = require('path');
const pkg = require('../package.json');

const { init } = require('../src/init');
const { checkpoint } = require('../src/checkpoint');
const { status } = require('../src/status');
const { generate } = require('../src/generate');
const { watch } = require('../src/watch');
const { log } = require('../src/decisions');
const { done, reset } = require('../src/lifecycle');

const program = new Command();

program
  .name('relay')
  .description(chalk.bold('relay-dev') + ' — Your AI\'s black box recorder.\nAuto-track project state so any AI tool picks up where the last one stopped.')
  .version(pkg.version);

// ─── init ───
program
  .command('init')
  .description('Initialize relay in your project. Creates .relay/ folder with config and hooks.')
  .option('--no-hooks', 'Skip installing git hooks')
  .action(async (opts) => {
    try {
      await init(process.cwd(), opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── checkpoint ───
program
  .command('checkpoint [message]')
  .alias('cp')
  .description('Save a checkpoint of current project state. Use when switching AI tools or pausing work.')
  .option('-t, --task <task>', 'Current task description')
  .option('-b, --blocker <blocker>', 'Current blocker or issue')
  .option('--next <next>', 'What should be done next')
  .action(async (message, opts) => {
    try {
      await checkpoint(process.cwd(), message, opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── status ───
program
  .command('status')
  .alias('s')
  .description('Show current relay state — what\'s being worked on, recent changes, blockers.')
  .option('--json', 'Output as JSON')
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
  .description('Generate AI context files from current relay state (HANDOFF.md, CLAUDE.md, .cursorrules, etc.)')
  .option('-a, --all', 'Generate for all supported AI tools')
  .option('--claude', 'Generate CLAUDE.md')
  .option('--cursor', 'Generate .cursor/rules')
  .option('--copilot', 'Generate .github/copilot-instructions.md')
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

// ─── watch ───
program
  .command('watch')
  .alias('w')
  .description('Start watching your project for changes and auto-update relay state in real-time.')
  .option('-i, --interval <ms>', 'Debounce interval in ms', '2000')
  .action(async (opts) => {
    try {
      await watch(process.cwd(), opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── log (decisions) ───
program
  .command('log <message>')
  .alias('l')
  .description('Log a decision or important note. Persists across sessions so the next AI knows WHY.')
  .option('--tag <tag>', 'Tag the decision (e.g., architecture, refactor, bugfix)')
  .action(async (message, opts) => {
    try {
      await log(process.cwd(), message, opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

// ─── done ───
program
  .command('done [message]')
  .alias('d')
  .description('Mark the current task as completed and archive it.')
  .action(async (message, opts) => {
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
  .description('Clear current task and start fresh. Does NOT delete decisions or history.')
  .option('-f, --full', 'Full reset — also clears decisions log')
  .action(async (opts) => {
    try {
      await reset(process.cwd(), opts);
    } catch (err) {
      console.error(chalk.red('Error:'), err.message);
      process.exit(1);
    }
  });

program.parse();
