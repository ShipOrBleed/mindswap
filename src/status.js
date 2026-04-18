const chalk = require('chalk');
const { readState, getDataDir, getHistory } = require('./state');
const { isGitRepo, getCurrentBranch, getAllChangedFiles } = require('./git');
const { findAllConflicts, checkDepsVsDecisions } = require('./conflicts');
const fs = require('fs');
const path = require('path');

async function status(projectRoot, opts = {}) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    console.log(chalk.yellow('\nmindswap not initialized. Run: npx mindswap init\n'));
    return;
  }

  const state = readState(projectRoot);

  if (opts.json) {
    console.log(JSON.stringify(state, null, 2));
    return;
  }

  console.log(chalk.bold('\n⚡ mindswap status\n'));

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

  // Build/test status
  if (state.test_status) {
    const ts = state.test_status;
    const icon = ts.status === 'pass' ? chalk.green('✓') : ts.status === 'fail' ? chalk.red('✗') : chalk.dim('○');
    let detail = ts.status;
    if (ts.passed != null) detail = `${ts.passed} passed, ${ts.failed || 0} failed`;
    console.log(chalk.dim('  Tests:       ') + icon + ' ' + chalk.white(detail));
  }
  if (state.build_status) {
    const bs = state.build_status;
    const icon = bs.status === 'pass' ? chalk.green('✓') : chalk.red('✗');
    console.log(chalk.dim('  Build:       ') + icon + ' ' + chalk.white(bs.status));
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
  const historyDir = path.join(dataDir, 'history');
  if (fs.existsSync(historyDir)) {
    const historyCount = fs.readdirSync(historyDir).filter(f => f.endsWith('.json')).length;
    console.log(chalk.dim('  History:     ') + chalk.white(`${historyCount} checkpoints`));
  }

  // Decisions count
  const decisionsPath = path.join(dataDir, 'decisions.log');
  if (fs.existsSync(decisionsPath)) {
    const lines = fs.readFileSync(decisionsPath, 'utf-8').split('\n').filter(l => l.startsWith('['));
    console.log(chalk.dim('  Decisions:   ') + chalk.white(`${lines.length} logged`));
  }

  // Conflict check
  const conflicts = findAllConflicts(projectRoot);
  const depConflicts = checkDepsVsDecisions(projectRoot);
  const totalConflicts = conflicts.length + depConflicts.length;
  if (totalConflicts > 0) {
    console.log();
    console.log(chalk.bold.yellow(`  ⚠  ${totalConflicts} conflict${totalConflicts > 1 ? 's' : ''} detected`));
    for (const c of conflicts.slice(0, 3)) {
      console.log(chalk.yellow(`    • ${c.reason}`));
    }
    for (const c of depConflicts.slice(0, 3)) {
      console.log(chalk.yellow(`    • ${c.reason}`));
    }
    if (totalConflicts > 6) {
      console.log(chalk.dim(`    ... and ${totalConflicts - 6} more (run mindswap summary for details)`));
    }
  }

  // Stats (optional)
  if (opts.stats) {
    printStats(projectRoot, dataDir);
  }

  console.log();
}

function printStats(projectRoot, dataDir) {
  const history = getHistory(projectRoot, 100);
  console.log(chalk.bold('\n  📊 Stats'));

  // Session span
  if (history.length >= 2) {
    const first = new Date(history[history.length - 1].timestamp);
    const last = new Date(history[0].timestamp);
    const durationMs = last - first;
    const hours = Math.floor(durationMs / 3600000);
    const minutes = Math.floor((durationMs % 3600000) / 60000);
    console.log(chalk.dim('  Span:        ') +
      chalk.white(hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`));
  }

  // Tools used
  const toolCounts = {};
  for (const h of history) {
    if (h.ai_tool) {
      for (const tool of h.ai_tool.split(', ')) {
        toolCounts[tool] = (toolCounts[tool] || 0) + 1;
      }
    }
  }
  if (Object.keys(toolCounts).length > 0) {
    console.log(chalk.dim('  Tools:'));
    for (const [tool, count] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
      const bar = '█'.repeat(Math.min(count, 15));
      console.log(chalk.dim(`    ${tool.padEnd(15)}`) + chalk.cyan(bar) + chalk.dim(` ${count}`));
    }
  }

  // Branch states
  const branchesDir = path.join(dataDir, 'branches');
  if (fs.existsSync(branchesDir)) {
    const branches = fs.readdirSync(branchesDir).filter(f => f.endsWith('.json'));
    if (branches.length > 1) {
      console.log(chalk.dim('  Branches:    ') + chalk.white(`${branches.length} tracked`));
    }
  }
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

module.exports = { status };
