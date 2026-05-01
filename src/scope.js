const fs = require('fs');
const os = require('os');
const { getDataDir } = require('./state');

function getGlobalProjectRoot() {
  return os.homedir();
}

function normalizeScope(opts = {}) {
  if (opts.scope) return String(opts.scope).toLowerCase();
  if (opts.global) return 'global';
  return 'repo';
}

function resolveMemoryRoots(projectRoot, opts = {}) {
  const scope = normalizeScope(opts);
  if (scope === 'global') return [getGlobalProjectRoot()];
  if (scope === 'all') return [projectRoot, getGlobalProjectRoot()];
  return [projectRoot];
}

function canUseRepoScope(projectRoot) {
  return fs.existsSync(getDataDir(projectRoot));
}

module.exports = {
  getGlobalProjectRoot,
  normalizeScope,
  resolveMemoryRoots,
  canUseRepoScope,
};
