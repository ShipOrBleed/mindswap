const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const GIT_TIMEOUT = 15000; // 15s max for any git command

function isGitRepo(projectRoot) {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectRoot, stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8', timeout: GIT_TIMEOUT }).trim();
  } catch {
    return '';
  }
}

function getCurrentBranch(projectRoot) {
  // Check for detached HEAD first
  const branch = run('git branch --show-current', projectRoot);
  if (branch) return branch;

  // Detached HEAD — show the short commit hash
  const head = run('git rev-parse --short HEAD', projectRoot);
  if (head) return `HEAD detached at ${head}`;

  return 'unknown';
}

function getRecentCommits(projectRoot, count = 5) {
  const raw = run(`git log --oneline -${count} --no-decorate`, projectRoot);
  if (!raw) return [];
  return raw.split('\n').map(line => {
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) return { hash: line, message: '' };
    return { hash: line.slice(0, spaceIdx), message: line.slice(spaceIdx + 1) };
  });
}

function getStagedFiles(projectRoot) {
  const raw = run('git diff --cached --name-status', projectRoot);
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map(line => {
    const [status, ...fileParts] = line.split('\t');
    return { status: statusLabel(status), file: fileParts.join('\t') };
  });
}

function getModifiedFiles(projectRoot) {
  const raw = run('git diff --name-status', projectRoot);
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map(line => {
    const [status, ...fileParts] = line.split('\t');
    return { status: statusLabel(status), file: fileParts.join('\t') };
  });
}

function getUntrackedFiles(projectRoot) {
  const raw = run('git ls-files --others --exclude-standard', projectRoot);
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map(f => ({ status: 'new', file: f }));
}

function getAllChangedFiles(projectRoot) {
  // Deduplicate files that appear in both staged and modified
  const seen = new Set();
  const result = [];
  for (const f of [...getStagedFiles(projectRoot), ...getModifiedFiles(projectRoot), ...getUntrackedFiles(projectRoot)]) {
    if (!seen.has(f.file)) {
      seen.add(f.file);
      result.push(f);
    }
  }
  return result;
}

function getDiffSummary(projectRoot) {
  const stat = run('git diff --stat', projectRoot);
  const staged = run('git diff --cached --stat', projectRoot);
  const parts = [];
  if (stat) parts.push('Working tree:\n' + stat);
  if (staged) parts.push('Staged:\n' + staged);
  return parts.join('\n\n') || 'No changes';
}

function getDiffContent(projectRoot, maxLines = 200) {
  const diff = run('git diff', projectRoot);
  if (!diff) return 'No uncommitted changes.';
  const lines = diff.split('\n');
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).join('\n') + `\n\n... (truncated, ${lines.length - maxLines} more lines)`;
  }
  return diff;
}

function getLastCommitInfo(projectRoot) {
  const hash = run('git rev-parse --short HEAD', projectRoot);
  const msg = run('git log -1 --format=%s', projectRoot);
  const time = run('git log -1 --format=%ci', projectRoot);
  return { hash, message: msg, time };
}

function statusLabel(code) {
  const map = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'unmerged' };
  return map[code] || code;
}

module.exports = {
  isGitRepo,
  getCurrentBranch,
  getRecentCommits,
  getStagedFiles,
  getModifiedFiles,
  getUntrackedFiles,
  getAllChangedFiles,
  getDiffSummary,
  getDiffContent,
  getLastCommitInfo,
};
