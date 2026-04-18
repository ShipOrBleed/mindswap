const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function isGitRepo(projectRoot) {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectRoot, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function run(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, stdio: 'pipe', encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

function getCurrentBranch(projectRoot) {
  return run('git branch --show-current', projectRoot) || 'unknown';
}

function getRecentCommits(projectRoot, count = 5) {
  const raw = run(`git log --oneline -${count} --no-decorate`, projectRoot);
  if (!raw) return [];
  return raw.split('\n').map(line => {
    const [hash, ...rest] = line.split(' ');
    return { hash, message: rest.join(' ') };
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
  return [
    ...getModifiedFiles(projectRoot),
    ...getStagedFiles(projectRoot),
    ...getUntrackedFiles(projectRoot),
  ];
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
