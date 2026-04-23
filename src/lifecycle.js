const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { readState, updateState, addToHistory, getDataDir } = require('./state');
const { ensureMemory, writeMemory, getDefaultMemory } = require('./memory');

async function done(projectRoot, message) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    console.log(chalk.yellow('\nmindswap not initialized. Run: npx mindswap init\n'));
    return;
  }

  const state = readState(projectRoot);
  const task = state.current_task;

  if (task.status === 'idle' && !task.description) {
    console.log(chalk.yellow('\nNo active task to complete.\n'));
    return;
  }

  const now = new Date().toISOString();
  const completedTask = {
    ...task,
    status: 'completed',
    completed_at: now,
    completion_note: message || null,
  };

  addToHistory(projectRoot, {
    timestamp: now,
    message: `done: ${task.description || 'task'}${message ? ` — ${message}` : ''}`,
    type: 'task_completed',
    task: completedTask,
  });

  updateState(projectRoot, {
    current_task: {
      description: '',
      started_at: null,
      status: 'idle',
      blocker: null,
      next_steps: [],
    },
  });

  try {
    const { generate } = require('./generate');
    await generate(projectRoot, { handoff: true, quiet: true });
  } catch {}

  console.log(chalk.bold('\n⚡ Task completed\n'));
  console.log(chalk.dim('  Task:     ') + chalk.white(task.description || '(unnamed)'));
  if (message) {
    console.log(chalk.dim('  Note:     ') + chalk.white(message));
  }
  console.log(chalk.dim('  Status:   ') + chalk.green('completed → idle'));
  console.log(chalk.dim('  Archived: ') + chalk.green('yes'));
  console.log();
}

async function reset(projectRoot, opts = {}) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    console.log(chalk.yellow('\nmindswap not initialized. Run: npx mindswap init\n'));
    return;
  }

  updateState(projectRoot, {
    current_task: {
      description: '',
      started_at: null,
      status: 'idle',
      blocker: null,
      next_steps: [],
    },
    last_checkpoint: {
      timestamp: null,
      message: '',
      ai_tool: null,
      files_changed: [],
      git_branch: null,
      git_diff_summary: '',
    },
    modified_files: [],
    build_status: null,
    test_status: null,
  });

  if (opts.full) {
    const decisionsPath = path.join(dataDir, 'decisions.log');
    const state = readState(projectRoot);
    const projectName = state.project?.name || 'project';
    fs.writeFileSync(
      decisionsPath,
      `# Decision Log — ${projectName}\n# Tracks WHY decisions were made so the next AI knows.\n# Format: [timestamp] [tag] message\n\n`,
      'utf-8'
    );
    ensureMemory(projectRoot);
    writeMemory(projectRoot, getDefaultMemory());
  }

  try {
    const { generate } = require('./generate');
    await generate(projectRoot, { handoff: true, quiet: true });
  } catch {}

  console.log(chalk.bold('\n⚡ State reset\n'));
  console.log(chalk.dim('  Task:      ') + chalk.green('cleared'));
  console.log(chalk.dim('  Checkpoint:') + chalk.green(' cleared'));
  console.log(chalk.dim('  Decisions: ') + chalk.white(opts.full ? 'cleared' : 'preserved'));
  console.log(chalk.dim('  History:   ') + chalk.white('preserved'));
  console.log();
}

module.exports = { done, reset };
