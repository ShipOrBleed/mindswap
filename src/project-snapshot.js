const fs = require('fs');
const path = require('path');
const { isGitRepo, getCurrentBranch, getAllChangedFiles, getRecentCommits } = require('./git');
const { readState, getHistory } = require('./state');
const { readMemory } = require('./memory');
const { parseNativeSessions } = require('./session-parser');
const { importSessions } = require('./session-import');
const { analyzeGuardrails } = require('./guardrails');

function createProjectSnapshot(projectRoot, opts = {}) {
  const gitRepo = isGitRepo(projectRoot);
  const changedFiles = gitRepo ? getAllChangedFiles(projectRoot) : [];
  const branch = gitRepo ? getCurrentBranch(projectRoot) : null;
  const state = readState(projectRoot);
  const history = getHistory(projectRoot, opts.historyLimit || 20);
  const recentCommits = gitRepo ? getRecentCommits(projectRoot, opts.recentCommitLimit || 5) : [];
  const memory = readMemory(projectRoot);
  const decisions = readDecisionLines(projectRoot);
  const nativeSessions = parseNativeSessions(projectRoot) || [];
  const importedSessions = importSessions(projectRoot) || [];
  const guardrails = analyzeGuardrails(projectRoot, {
    changedFiles,
    diffContent: '',
  });

  return {
    projectRoot,
    gitRepo,
    branch,
    changedFiles,
    recentCommits,
    state,
    history,
    memory,
    decisions,
    nativeSessions,
    importedSessions,
    guardrails,
  };
}

function readDecisionLines(projectRoot) {
  const decisionsPath = path.join(projectRoot, '.mindswap', 'decisions.log');
  if (!fs.existsSync(decisionsPath)) return [];
  return fs.readFileSync(decisionsPath, 'utf-8')
    .split('\n')
    .filter(line => line.startsWith('['));
}

module.exports = {
  createProjectSnapshot,
  readDecisionLines,
};
