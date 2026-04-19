const { execSync } = require('child_process');
const chalk = require('chalk');
const { readState, getDataDir, getHistory } = require('./state');
const { isGitRepo, getCurrentBranch, getRecentCommits } = require('./git');
const { buildNarrative } = require('./narrative');
const { save } = require('./save');
const fs = require('fs');
const path = require('path');

/**
 * Add mindswap context to a GitHub PR.
 * Either creates a new PR or updates an existing one.
 */
async function pr(projectRoot, opts = {}) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    console.log(chalk.yellow('\nmindswap not initialized. Run: npx mindswap init\n'));
    return;
  }

  if (!isGitRepo(projectRoot)) {
    console.log(chalk.yellow('\nNot a git repository.\n'));
    return;
  }

  // Check if gh CLI is available
  try {
    execSync('gh --version', { stdio: 'pipe', timeout: 5000 });
  } catch {
    console.log(chalk.yellow('\nGitHub CLI (gh) not found. Install it: https://cli.github.com\n'));
    return;
  }

  console.log(chalk.bold('\n⚡ Generating PR context...\n'));

  // Save state first
  await save(projectRoot, { quiet: true });

  const state = readState(projectRoot);
  const branch = getCurrentBranch(projectRoot);
  const commits = getRecentCommits(projectRoot, 20);
  const history = getHistory(projectRoot, 10);

  // Read decisions
  const decisionsPath = path.join(dataDir, 'decisions.log');
  let decisions = [];
  if (fs.existsSync(decisionsPath)) {
    decisions = fs.readFileSync(decisionsPath, 'utf-8')
      .split('\n')
      .filter(l => l.startsWith('['))
      .map(l => l.replace(/^\[.*?\]\s*\[.*?\]\s*/, '').trim());
  }

  // Build PR context section
  const liveData = {
    branch,
    changedFiles: [],
    recentCommits: commits,
    decisions: decisions.map((d, i) => `[decision] ${d}`),
    history,
  };
  const narrative = buildNarrative(state, liveData);

  const contextSection = buildPRContext(state, narrative, decisions, commits);

  // Check if PR already exists for this branch
  const existingPR = getExistingPR(projectRoot, branch);

  if (existingPR) {
    // Update existing PR
    if (opts.update !== false) {
      updatePRBody(projectRoot, existingPR, contextSection);
      console.log(chalk.green('  ✓ ') + `Updated PR #${existingPR.number} with mindswap context`);
      console.log(chalk.dim('  URL: ') + chalk.white(existingPR.url));
    }
  } else if (opts.create !== false) {
    // Show what would be added
    console.log(chalk.dim('  No open PR for branch ') + chalk.white(branch));
    console.log(chalk.dim('  Create one with: ') + chalk.white(`gh pr create --body "$(npx mindswap pr --body-only)"`));
    console.log();
    console.log(chalk.dim('  Or copy this context:\n'));
    console.log(contextSection);
  }

  // Body-only mode — just output the context for piping
  if (opts.bodyOnly) {
    process.stdout.write(contextSection);
    return;
  }

  console.log();
}

/**
 * Build the PR context section.
 */
function buildPRContext(state, narrative, decisions, commits) {
  const proj = state.project;
  const task = state.current_task;
  const lines = [];

  lines.push('## mindswap context');
  lines.push('');
  lines.push(`> ${narrative}`);
  lines.push('');

  // Task
  if (task.description && task.status !== 'idle') {
    lines.push(`**Task:** ${task.description}`);
    if (task.next_steps?.length) {
      lines.push(`**Next:** ${task.next_steps.join(', ')}`);
    }
    lines.push('');
  }

  // Key decisions
  if (decisions.length > 0) {
    lines.push('**Key decisions:**');
    for (const d of decisions.slice(-7)) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  // Test status
  if (state.test_status?.passed != null) {
    const ts = state.test_status;
    const status = ts.failed > 0 ? `${ts.failed} failing` : 'all passing';
    lines.push(`**Tests:** ${ts.passed} passed, ${status}`);
    lines.push('');
  }

  // Stack
  lines.push(`**Stack:** ${proj.tech_stack?.join(', ') || 'unknown'}`);

  return lines.join('\n');
}

/**
 * Get existing PR for the current branch.
 */
function getExistingPR(projectRoot, branch) {
  try {
    const result = execSync(
      `gh pr view --json number,url,body --jq '{number: .number, url: .url, body: .body}'`,
      { cwd: projectRoot, encoding: 'utf-8', stdio: 'pipe', timeout: 10000 }
    );
    return JSON.parse(result);
  } catch {
    return null;
  }
}

/**
 * Update an existing PR body with mindswap context.
 * Appends or replaces the mindswap section.
 */
function updatePRBody(projectRoot, pr, contextSection) {
  const MARKER_START = '<!-- mindswap:pr:start -->';
  const MARKER_END = '<!-- mindswap:pr:end -->';
  const wrapped = `${MARKER_START}\n${contextSection}\n${MARKER_END}`;

  let newBody;
  if (pr.body?.includes(MARKER_START)) {
    // Replace existing section
    const before = pr.body.substring(0, pr.body.indexOf(MARKER_START));
    const after = pr.body.substring(pr.body.indexOf(MARKER_END) + MARKER_END.length);
    newBody = before + wrapped + after;
  } else {
    // Append
    newBody = (pr.body || '') + '\n\n' + wrapped;
  }

  try {
    // Write body to temp file to avoid shell escaping issues
    const tmpFile = path.join(require('os').tmpdir(), 'mindswap-pr-body.md');
    fs.writeFileSync(tmpFile, newBody, 'utf-8');
    execSync(`gh pr edit ${pr.number} --body-file "${tmpFile}"`, {
      cwd: projectRoot, stdio: 'pipe', timeout: 15000,
    });
    fs.unlinkSync(tmpFile);
  } catch (err) {
    console.log(chalk.yellow('  ⚠  Could not update PR body: ' + (err.message || 'unknown error')));
  }
}

module.exports = { pr, buildPRContext };
