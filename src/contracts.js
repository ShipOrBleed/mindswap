const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { readState, getDataDir, getHistory } = require('./state');
const { isGitRepo, getCurrentBranch, getAllChangedFiles } = require('./git');
const { getOpenMemoryItems, getMemoryItems } = require('./memory');
const { detectMonorepo, detectChangedPackages } = require('./monorepo');
const { detectWorkPatterns } = require('./narrative');
const { isTeamMode, getAuthorIdentity } = require('./team');

async function contracts(projectRoot, opts = {}) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    console.log(chalk.yellow('\nmindswap not initialized. Run: npx mindswap init\n'));
    return;
  }

  const payload = buildContracts(projectRoot);
  const json = JSON.stringify(payload, null, 2);

  fs.writeFileSync(path.join(dataDir, 'contracts.json'), json, 'utf-8');
  fs.writeFileSync(path.join(projectRoot, 'CONTRACTS.json'), json, 'utf-8');

  if (opts.json === false) {
    console.log(chalk.bold('\n⚡ Interface Contracts\n'));
    console.log(json);
    console.log();
    return;
  }

  console.log(json);
}

function buildContracts(projectRoot) {
  const state = readState(projectRoot);
  const changedFiles = isGitRepo(projectRoot) ? getAllChangedFiles(projectRoot) : [];
  const history = getHistory(projectRoot, 10);
  const branch = isGitRepo(projectRoot) ? getCurrentBranch(projectRoot) : null;
  const projectPatterns = detectWorkPatterns(changedFiles);
  const monorepo = detectMonorepo(projectRoot);
  const changedPkgs = monorepo.isMonorepo ? detectChangedPackages(monorepo, changedFiles) : [];
  const blockers = getOpenMemoryItems(projectRoot, 'blocker', 10);
  const assumptions = getOpenMemoryItems(projectRoot, 'assumption', 10);
  const questions = getOpenMemoryItems(projectRoot, 'question', 10);
  const resolutions = getMemoryItems(projectRoot, { type: 'resolution', limit: 10 });
  const author = isTeamMode(projectRoot) ? getAuthorIdentity(projectRoot) : null;

  return {
    version: '1.0.0',
    generated_at: new Date().toISOString(),
    project: {
      name: state.project?.name || path.basename(projectRoot),
      branch,
      language: state.project?.language || 'unknown',
      framework: state.project?.framework || 'none',
      stack: state.project?.tech_stack || [],
      monorepo: monorepo.isMonorepo ? monorepo.tool : null,
      changed_packages: changedPkgs,
    },
    owner: author ? { type: 'author', identity: author } : null,
    contracts: buildContractEntries({
      projectRoot,
      state,
      changedFiles,
      history,
      projectPatterns,
      blockers,
      assumptions,
      questions,
      resolutions,
      author,
    }),
  };
}

function buildContractEntries({ projectRoot, state, changedFiles, history, projectPatterns, blockers, assumptions, questions, resolutions, author }) {
  const task = state.current_task || {};
  const decisions = readDecisionLines(projectRoot);
  const recentHistory = history.slice(0, 5);
  const areas = projectPatterns.length > 0 ? projectPatterns : inferAreasFromFiles(changedFiles);

  const contract = {
    id: 'current-workstream',
    type: 'workflow',
    name: task.description || state.project?.name || 'current-workstream',
    boundaries: areas.length > 0
      ? areas.map(area => `Scope includes ${area}`)
      : ['Scope is the current feature and associated handoff only'],
    inputs: [
      'Current project state from HANDOFF.md',
      'Recent commits and changed files',
      'Open blockers, assumptions, and questions',
    ],
    outputs: [
      'Updated state.json',
      'Updated decisions.log and memory.json',
      'Refreshed handoff files',
    ],
    blockers: [
      ...(task.blocker ? [task.blocker] : []),
      ...blockers.map(item => item.message),
    ],
    assumptions: assumptions.map(item => item.message),
    invariants: [
      ...decisions.slice(0, 5),
      ...(resolutions.slice(0, 3).map(item => item.message)),
    ],
    owner: author || null,
    status: task.status || 'idle',
    recent_history: recentHistory.map(entry => ({
      timestamp: entry.timestamp,
      message: entry.message,
      author: entry.author || null,
      ai_tool: entry.ai_tool || null,
    })),
    open_questions: questions.map(item => item.message),
    changed_files: changedFiles.slice(0, 20).map(file => ({
      status: file.status,
      file: file.file,
    })),
  };

  return [contract];
}

function inferAreasFromFiles(changedFiles = []) {
  const files = changedFiles.map(f => (f.file || f).toLowerCase());
  const areas = new Set();
  for (const file of files) {
    if (file.includes('auth') || file.includes('login') || file.includes('session') || file.includes('jwt')) areas.add('authentication');
    if (file.includes('db') || file.includes('migration') || file.includes('schema') || file.includes('sql')) areas.add('database');
    if (file.includes('api') || file.includes('route') || file.includes('controller') || file.includes('handler')) areas.add('api');
    if (file.includes('test') || file.includes('spec')) areas.add('tests');
    if (file.includes('component') || file.includes('ui') || file.includes('page')) areas.add('ui');
  }
  return [...areas];
}

function readDecisionLines(projectRoot) {
  try {
    const decisionsPath = path.join(getDataDir(projectRoot), 'decisions.log');
    if (!fs.existsSync(decisionsPath)) return [];
    return fs.readFileSync(decisionsPath, 'utf-8')
      .split('\n')
      .filter(line => line.startsWith('['))
      .slice(-10)
      .map(line => line.replace(/^\[.*?\]\s*\[.*?\]\s*/, '').trim());
  } catch {
    return [];
  }
}

module.exports = {
  contracts,
  buildContracts,
  buildContractEntries,
  inferAreasFromFiles,
};
