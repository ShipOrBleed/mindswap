const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { readState, updateState, addToHistory, getRelayDir } = require('./state');

/**
 * Mark the current task as completed, archive it, and reset to idle.
 */
async function done(projectRoot, message) {
  const relayDir = getRelayDir(projectRoot);
  if (!fs.existsSync(relayDir)) {
    console.log(chalk.yellow('\nrelay not initialized. Run: npx relay init\n'));
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

  // Archive to history
  addToHistory(projectRoot, {
    timestamp: now,
    message: `done: ${task.description || 'task'}${message ? ` — ${message}` : ''}`,
    type: 'task_completed',
    task: completedTask,
  });

  // Reset current task to idle
  updateState(projectRoot, {
    current_task: {
      description: '',
      started_at: null,
      status: 'idle',
      blocker: null,
      next_steps: [],
    },
  });

  // Auto-regenerate HANDOFF.md
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

/**
 * Reset current task state. Preserves decisions and history unless --full.
 */
async function reset(projectRoot, opts = {}) {
  const relayDir = getRelayDir(projectRoot);
  if (!fs.existsSync(relayDir)) {
    console.log(chalk.yellow('\nrelay not initialized. Run: npx relay init\n'));
    return;
  }

  // Reset task state
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
  });

  // Full reset — also clear decisions
  if (opts.full) {
    const decisionsPath = path.join(relayDir, 'decisions.log');
    const state = readState(projectRoot);
    const projectName = state.project?.name || 'project';
    fs.writeFileSync(
      decisionsPath,
      `# Decision Log — ${projectName}\n# Tracks WHY decisions were made so the next AI knows.\n# Format: [timestamp] [tag] message\n\n`,
      'utf-8'
    );
  }

  // Auto-regenerate HANDOFF.md
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
