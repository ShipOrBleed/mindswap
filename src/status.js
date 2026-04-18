const chalk = require('chalk');
const { readState, getRelayDir } = require('./state');
const { isGitRepo, getCurrentBranch, getAllChangedFiles } = require('./git');
const fs = require('fs');
const path = require('path');

async function status(projectRoot, opts = {}) {
  const relayDir = getRelayDir(projectRoot);
  if (!fs.existsSync(relayDir)) {
    console.log(chalk.yellow('\nrelay not initialized. Run: npx relay init\n'));
    return;
  }

  const state = readState(projectRoot);

  if (opts.json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  console.log(chalk.bold('\n⚡ relay status\n'));

  // Project info
  console.log(chalk.dim('  Project:     ') + chalk.white(state.project.name));
  console.log(chalk.dim('  Stack:       ') + chalk.white(state.project.tech_stack.join(', ') || 'unknown'));

  // Git
  if (isGitRepo(projectRoot)) {
    console.log(chalk.dim('  Branch:      ') + chalk.white(getCurrentBranch(projectRoot)));
    const changed = getAllChangedFiles(projectRoot);
    console.log(chalk.dim('  Changed:     ') + chalk.white(`${changed.length} files`));
  }

  // Current task
  console.log();
  const task = state.current_task;
  const statusColor = {
    idle: chalk.gray,
    in_progress: chalk.cyan,
    blocked: chalk.red,
    paused: chalk.yellow,
    completed: chalk.green,
  };
  const colorFn = statusColor[task.status] || chalk.white;
  console.log(chalk.dim('  Task:        ') + chalk.white(task.description || '(none)'));
  console.log(chalk.dim('  Status:      ') + colorFn(task.status));
  if (task.blocker) {
    console.log(chalk.dim('  Blocker:     ') + chalk.red(task.blocker));
  }
  if (task.next_steps?.length) {
    console.log(chalk.dim('  Next:        ') + chalk.white(task.next_steps.join(', ')));
  }

  // Last checkpoint
  console.log();
  const cp = state.last_checkpoint;
  if (cp.timestamp) {
    const ago = timeAgo(new Date(cp.timestamp));
    console.log(chalk.dim('  Last save:   ') + chalk.white(`${cp.message} (${ago})`));
    if (cp.ai_tool) {
      console.log(chalk.dim('  AI tool:     ') + chalk.white(cp.ai_tool));
    }
  } else {
    console.log(chalk.dim('  Last save:   ') + chalk.gray('no checkpoints yet'));
  }

  // History count
  const historyDir = path.join(relayDir, 'history');
  if (fs.existsSync(historyDir)) {
    const historyCount = fs.readdirSync(historyDir).filter(f => f.endsWith('.json')).length;
    console.log(chalk.dim('  History:     ') + chalk.white(`${historyCount} checkpoints`));
  }

  // Decisions count
  const decisionsPath = path.join(relayDir, 'decisions.log');
  if (fs.existsSync(decisionsPath)) {
    const lines = fs.readFileSync(decisionsPath, 'utf-8').split('\n').filter(l => l.startsWith('['));
    console.log(chalk.dim('  Decisions:   ') + chalk.white(`${lines.length} logged`));
  }

  console.log();
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

module.exports = { status };
