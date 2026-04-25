const fs = require('fs');
const path = require('path');
const { isGitRepo, getCurrentBranch, getAllChangedFiles, getRecentCommits } = require('./git');
const { readState, getHistory } = require('./state');
const { readMemory } = require('./memory');
const { parseNativeSessions } = require('./session-parser');
const { importSessions } = require('./session-import');
const { analyzeGuardrails } = require('./guardrails');

const snapshotCache = new Map();

function createProjectSnapshot(projectRoot, opts = {}) {
  const signature = buildSnapshotSignature(projectRoot, opts);
  const cached = snapshotCache.get(signature);
  if (cached) return cached;

  const gitRepo = isGitRepo(projectRoot);
  const changedFiles = gitRepo ? getAllChangedFiles(projectRoot) : [];
  const branch = gitRepo ? getCurrentBranch(projectRoot) : null;
  const state = readState(projectRoot);
  const history = getHistory(projectRoot, opts.historyLimit || 20);
  const recentCommits = gitRepo ? getRecentCommits(projectRoot, opts.recentCommitLimit || 5) : [];
  const memory = readMemory(projectRoot);
  const decisions = readDecisionLines(projectRoot);

  const snapshot = {
    projectRoot,
    gitRepo,
    branch,
    changedFiles,
    recentCommits,
    state,
    history,
    memory,
    decisions,
  };

  defineLazyProperty(snapshot, 'nativeSessions', () => parseNativeSessions(projectRoot) || []);
  defineLazyProperty(snapshot, 'importedSessions', () => importSessions(projectRoot) || []);
  defineLazyProperty(snapshot, 'guardrails', () => analyzeGuardrails(projectRoot, {
    changedFiles,
    diffContent: '',
  }));

  snapshotCache.set(signature, snapshot);
  return snapshot;
}

function readDecisionLines(projectRoot) {
  const decisionsPath = path.join(projectRoot, '.mindswap', 'decisions.log');
  if (!fs.existsSync(decisionsPath)) return [];
  return fs.readFileSync(decisionsPath, 'utf-8')
    .split('\n')
    .filter(line => line.startsWith('['));
}

function buildSnapshotSignature(projectRoot, opts = {}) {
  const parts = [
    projectRoot,
    String(opts.historyLimit || 20),
    String(opts.recentCommitLimit || 5),
    fileSignature(path.join(projectRoot, '.mindswap', 'state.json')),
    dirSignature(path.join(projectRoot, '.mindswap', 'history')),
    fileSignature(path.join(projectRoot, '.mindswap', 'memory.json')),
    fileSignature(path.join(projectRoot, '.mindswap', 'decisions.log')),
    dirSignature(path.join(projectRoot, '.claude')),
    dirSignature(path.join(projectRoot, '.claude', 'projects')),
    dirSignature(path.join(projectRoot, '.cursor')),
    dirSignature(path.join(projectRoot, '.cursor', 'rules')),
    fileSignature(path.join(projectRoot, '.aider.conf.yml')),
    fileSignature(path.join(projectRoot, 'CONVENTIONS.md')),
    fileSignature(path.join(projectRoot, 'CLAUDE.md')),
    fileSignature(path.join(projectRoot, 'CODEX.md')),
    fileSignature(path.join(projectRoot, 'AGENTS.md')),
    fileSignature(path.join(projectRoot, 'HANDOFF.md')),
    dirSignature(path.join(projectRoot, '.amp')),
    dirSignature(path.join(projectRoot, '.cline')),
    dirSignature(path.join(projectRoot, '.roo')),
  ];

  return parts.join('|');
}

function fileSignature(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return 'f:na';
    return `f:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'f:missing';
  }
}

function dirSignature(dirPath) {
  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return 'd:na';
    return `d:${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'd:missing';
  }
}

function defineLazyProperty(target, key, loader) {
  let loaded = false;
  let value;
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: false,
    get() {
      if (!loaded) {
        value = loader();
        loaded = true;
      }
      return value;
    },
  });
}

module.exports = {
  createProjectSnapshot,
  readDecisionLines,
};
