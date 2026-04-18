const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { readState, getDataDir, getHistory } = require('./state');
const { isGitRepo, getCurrentBranch, getRecentCommits, getAllChangedFiles } = require('./git');
const { findAllConflicts, checkDepsVsDecisions } = require('./conflicts');

async function summary(projectRoot, opts = {}) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    console.log(chalk.yellow('\nmindswap not initialized. Run: npx mindswap init\n'));
    return;
  }

  const state = readState(projectRoot);
  const proj = state.project;
  const task = state.current_task;
  const history = getHistory(projectRoot, 20);

  // Gather data (optionally filter by tag)
  let decisions = readDecisions(projectRoot);
  if (opts.tag) {
    decisions = decisions.filter(d => d.toLowerCase().includes(`[${opts.tag.toLowerCase()}]`));
  }
  const commits = isGitRepo(projectRoot) ? getRecentCommits(projectRoot, 10) : [];
  const branch = isGitRepo(projectRoot) ? getCurrentBranch(projectRoot) : null;
  const changedFiles = isGitRepo(projectRoot) ? getAllChangedFiles(projectRoot) : [];
  const conflicts = findAllConflicts(projectRoot);
  const depConflicts = checkDepsVsDecisions(projectRoot);

  if (opts.json) {
    console.log(JSON.stringify({
      project: proj, task, branch, decisions,
      commits: commits.slice(0, 5),
      changedFiles: changedFiles.length,
      checkpoints: history.length,
      conflicts: conflicts.length + depConflicts.length,
    }, null, 2));
    return;
  }

  // Build narrative
  const narrative = buildNarrative(proj, task, branch, decisions, commits, changedFiles, history, state);

  console.log(chalk.bold('\n⚡ Session Summary\n'));
  console.log(narrative);

  // Show conflicts if any
  if (conflicts.length > 0 || depConflicts.length > 0) {
    console.log(chalk.bold.yellow('\n⚠  Conflicts detected\n'));
    for (const c of conflicts) {
      console.log(chalk.yellow(`  • ${c.reason}`));
      console.log(chalk.dim(`    A: ${c.a}`));
      console.log(chalk.dim(`    B: ${c.b}`));
    }
    for (const c of depConflicts) {
      console.log(chalk.yellow(`  • ${c.reason}`));
      console.log(chalk.dim(`    Decision: ${c.decision}`));
    }
  }

  // Stats
  if (opts.stats) {
    printStats(history, decisions, commits, changedFiles);
  }

  console.log();
}

function buildNarrative(proj, task, branch, decisions, commits, changedFiles, history, state) {
  const lines = [];

  // Project intro
  lines.push(chalk.dim('  Project: ') + chalk.white(`${proj.name}`) +
    chalk.dim(` (${proj.language || 'unknown'}${proj.framework ? ` / ${proj.framework}` : ''})`));

  if (branch) {
    lines.push(chalk.dim('  Branch:  ') + chalk.white(branch));
  }

  lines.push('');

  // Current task
  if (task.description && task.status !== 'idle') {
    const statusColor = {
      in_progress: chalk.cyan,
      blocked: chalk.red,
      paused: chalk.yellow,
    };
    const colorFn = statusColor[task.status] || chalk.white;
    lines.push(chalk.dim('  Current task: ') + chalk.white(task.description));
    lines.push(chalk.dim('  Status:       ') + colorFn(task.status));
    if (task.blocker) {
      lines.push(chalk.dim('  Blocker:      ') + chalk.red(task.blocker));
    }
    if (task.next_steps?.length) {
      lines.push(chalk.dim('  Next steps:   ') + chalk.white(task.next_steps.join(', ')));
    }
  } else {
    lines.push(chalk.dim('  Current task: ') + chalk.gray('idle — no active task'));
  }

  // Build/test status
  if (state.test_status) {
    const ts = state.test_status;
    const icon = ts.status === 'pass' ? chalk.green('✓') : chalk.red('✗');
    let detail = ts.status;
    if (ts.passed != null) detail = `${ts.passed} passed, ${ts.failed || 0} failed`;
    lines.push(chalk.dim('  Tests:        ') + icon + ' ' + chalk.white(detail));
  }
  if (state.build_status) {
    const bs = state.build_status;
    const icon = bs.status === 'pass' ? chalk.green('✓') : chalk.red('✗');
    lines.push(chalk.dim('  Build:        ') + icon + ' ' + chalk.white(bs.status));
  }

  lines.push('');

  // Recent activity narrative
  if (commits.length > 0) {
    lines.push(chalk.dim('  Recent work:'));
    for (const c of commits.slice(0, 5)) {
      lines.push(chalk.dim('    • ') + chalk.white(c.message));
    }
  }

  // Uncommitted work
  if (changedFiles.length > 0) {
    lines.push('');
    lines.push(chalk.dim(`  Uncommitted:  `) + chalk.yellow(`${changedFiles.length} files`));
    const grouped = groupByStatus(changedFiles);
    for (const [status, files] of Object.entries(grouped)) {
      const names = files.slice(0, 3).map(f => path.basename(f));
      const extra = files.length > 3 ? ` +${files.length - 3} more` : '';
      lines.push(chalk.dim(`    ${status}: `) + chalk.white(names.join(', ') + extra));
    }
  }

  // Key decisions
  if (decisions.length > 0) {
    lines.push('');
    lines.push(chalk.dim('  Key decisions:'));
    for (const d of decisions.slice(-5)) {
      const msg = d.replace(/^\[.*?\]\s*\[.*?\]\s*/, '');
      lines.push(chalk.dim('    • ') + chalk.white(msg));
    }
  }

  // Session history
  if (history.length > 0) {
    const toolsSeen = new Set(history.map(h => h.ai_tool).filter(Boolean));
    if (toolsSeen.size > 0) {
      lines.push('');
      lines.push(chalk.dim('  AI tools used: ') + chalk.white([...toolsSeen].join(', ')));
    }
    lines.push(chalk.dim('  Checkpoints:   ') + chalk.white(`${history.length}`));
  }

  return lines.join('\n');
}

function printStats(history, decisions, commits, changedFiles) {
  console.log(chalk.bold('\n📊 Stats\n'));

  // Session duration
  if (history.length >= 2) {
    const first = new Date(history[history.length - 1].timestamp);
    const last = new Date(history[0].timestamp);
    const durationMs = last - first;
    const hours = Math.floor(durationMs / 3600000);
    const minutes = Math.floor((durationMs % 3600000) / 60000);
    console.log(chalk.dim('  Session span:   ') +
      chalk.white(hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`));
  }

  console.log(chalk.dim('  Checkpoints:    ') + chalk.white(history.length));
  console.log(chalk.dim('  Decisions:      ') + chalk.white(decisions.length));
  console.log(chalk.dim('  Commits:        ') + chalk.white(commits.length));
  console.log(chalk.dim('  Files changed:  ') + chalk.white(changedFiles.length));

  // Tools distribution
  const toolCounts = {};
  for (const h of history) {
    if (h.ai_tool) {
      for (const tool of h.ai_tool.split(', ')) {
        toolCounts[tool] = (toolCounts[tool] || 0) + 1;
      }
    }
  }
  if (Object.keys(toolCounts).length > 0) {
    console.log(chalk.dim('  Tool usage:'));
    for (const [tool, count] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
      const bar = '█'.repeat(Math.min(count, 20));
      console.log(chalk.dim(`    ${tool.padEnd(15)}`) + chalk.cyan(bar) + chalk.dim(` ${count}`));
    }
  }
}

function readDecisions(projectRoot) {
  const decisionsPath = path.join(projectRoot, '.mindswap', 'decisions.log');
  if (!fs.existsSync(decisionsPath)) return [];
  return fs.readFileSync(decisionsPath, 'utf-8')
    .split('\n')
    .filter(l => l.startsWith('['));
}

function groupByStatus(files) {
  const groups = {};
  for (const f of files) {
    const status = f.status || 'unknown';
    if (!groups[status]) groups[status] = [];
    groups[status].push(f.file);
  }
  return groups;
}

module.exports = { summary };
