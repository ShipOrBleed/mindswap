const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { getDataDir, readState, updateState, getHistory, addToHistory } = require('./state');
const { isGitRepo, getCurrentBranch } = require('./git');
const { readMemory, writeMemory, getDefaultMemory } = require('./memory');
const { annotateHistoryEntry } = require('./team');

async function sync(projectRoot, opts = {}) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    console.log(chalk.yellow('\nmindswap not initialized. Run: npx mindswap init\n'));
    return;
  }

  const hubPath = getSyncHubPath(projectRoot, opts);
  const mode = opts.pull ? 'pull' : opts.push ? 'push' : 'status';
  const local = buildLocalSnapshot(projectRoot);
  const hub = readHubSnapshot(hubPath);
  const report = buildSyncReport({ local, hub, hubPath, mode });

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (mode === 'status') {
    printSyncReport(report);
    return;
  }

  if (mode === 'push') {
    if (report.conflict && !opts.force) {
      printSyncReport(report);
      process.exitCode = 1;
      return;
    }
    writeHubSnapshot(hubPath, local);
    addToHistory(projectRoot, {
      timestamp: new Date().toISOString(),
      message: `synced local state to hub (${path.basename(hubPath)})`,
      type: 'sync_push',
      ai_tool: 'mindswap',
    });
    console.log(chalk.bold('\n⚡ Sync\n'));
    console.log(chalk.green(`  Pushed to ${hubPath}`));
    console.log(chalk.dim(`  Status: ${report.status}`));
    console.log();
    return;
  }

  if (mode === 'pull') {
    if (!hub) {
      console.log(chalk.yellow(`\nNo sync hub found at ${hubPath}\n`));
      process.exitCode = 1;
      return;
    }
    if (report.conflict && !opts.force) {
      printSyncReport(report);
      process.exitCode = 1;
      return;
    }

    applyHubSnapshot(projectRoot, hub);
    addToHistory(projectRoot, {
      timestamp: new Date().toISOString(),
      message: `pulled shared state from hub (${path.basename(hubPath)})`,
      type: 'sync_pull',
      ai_tool: 'mindswap',
    });
    console.log(chalk.bold('\n⚡ Sync\n'));
    console.log(chalk.green(`  Pulled from ${hubPath}`));
    console.log(chalk.dim(`  Status: ${report.status}`));
    console.log();
  }
}

function buildLocalSnapshot(projectRoot) {
  const state = readState(projectRoot);
  return {
    version: '1.0.0',
    updated_at: state.last_checkpoint?.timestamp || new Date().toISOString(),
    branch: isGitRepo(projectRoot) ? getCurrentBranch(projectRoot) : null,
    state,
    history: getHistory(projectRoot, 20),
    memory: readMemory(projectRoot),
  };
}

function buildSyncReport({ local, hub, hubPath, mode }) {
  const localTime = timestampValue(local?.updated_at);
  const hubTime = timestampValue(hub?.updated_at);
  const status = !hub
    ? 'no-hub'
    : localTime === hubTime
      ? 'in-sync'
      : localTime > hubTime
        ? 'local-ahead'
        : 'hub-ahead';

  const diverged = Boolean(hub && localTime && hubTime && (localTime !== hubTime || !sameBranch(local, hub)));
  const conflict = Boolean(
    diverged && (
      mode === 'status' ||
      (mode === 'push' && status === 'hub-ahead') ||
      (mode === 'pull' && status === 'local-ahead')
    )
  );

  const report = {
    mode,
    hub_path: hubPath,
    status,
    conflict,
    diverged,
    local_updated_at: local?.updated_at || null,
    hub_updated_at: hub?.updated_at || null,
    local_branch: local?.branch || null,
    hub_branch: hub?.branch || null,
    local_history: local?.history?.length || 0,
    hub_history: hub?.history?.length || 0,
    memory_items: local?.memory?.items?.length || 0,
    message: buildStatusMessage(status, conflict, hubPath),
  };

  return report;
}

function buildStatusMessage(status, conflict, hubPath) {
  if (status === 'no-hub') return `No sync hub found at ${hubPath}`;
  if (conflict) return 'Local and shared state are diverged. Resolve before pushing or pulling.';
  if (status === 'in-sync') return 'Local state is in sync with the shared hub.';
  if (status === 'local-ahead') return 'Local state is newer than the shared hub.';
  if (status === 'hub-ahead') return 'Shared hub state is newer than local state.';
  return 'Sync status unknown.';
}

function printSyncReport(report) {
  console.log(chalk.bold('\n⚡ Sync Status\n'));
  console.log(chalk.white(`  ${report.message}`));
  console.log(chalk.dim(`  Mode:   ${report.mode}`));
  console.log(chalk.dim(`  Local:  ${report.local_updated_at || 'none'}`));
  console.log(chalk.dim(`  Hub:    ${report.hub_updated_at || 'none'}`));
  if (report.diverged) {
    console.log(chalk.dim(`  Divergence: ${report.conflict ? 'blocking' : 'non-blocking'}`));
  }
  if (report.conflict) {
    console.log(chalk.bold.yellow('\n  ⚠  Conflict detected'));
    console.log(chalk.yellow('  Resolve the divergence before pushing or pulling without --force.'));
  }
  console.log();
}

function getSyncHubPath(projectRoot, opts = {}) {
  return path.resolve(opts.hub || process.env.MINDSWAP_SYNC_HUB || path.join(projectRoot, '.mindswap', 'sync-hub.json'));
}

function readHubSnapshot(hubPath) {
  if (!fs.existsSync(hubPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(hubPath, 'utf-8'));
  } catch {
    return null;
  }
}

function writeHubSnapshot(hubPath, snapshot) {
  fs.mkdirSync(path.dirname(hubPath), { recursive: true });
  fs.writeFileSync(hubPath, JSON.stringify(snapshot, null, 2), 'utf-8');
}

function applyHubSnapshot(projectRoot, hub) {
  if (!hub?.state) return;
  updateState(projectRoot, hub.state);

  if (hub.memory?.items) {
    const memory = readMemory(projectRoot);
    const existing = new Set((memory.items || []).map(item => item.id || `${item.type}:${item.message}`));
    for (const item of hub.memory.items) {
      const key = item.id || `${item.type}:${item.message}`;
      if (existing.has(key)) continue;
      memory.items.push(item);
    }
    writeMemory(projectRoot, memory);
  }

  if (Array.isArray(hub.history)) {
    const existingHistory = new Set(getHistory(projectRoot, 200).map(historyEntryKey));
    for (const entry of hub.history.slice(-20)) {
      const key = historyEntryKey(annotateHistoryEntry(projectRoot, entry));
      if (existingHistory.has(key)) continue;
      addToHistory(projectRoot, entry);
      existingHistory.add(key);
    }
  }
}

function sameBranch(local, hub) {
  if (!local?.branch || !hub?.branch) return true;
  return local.branch === hub.branch;
}

function timestampValue(value) {
  const parsed = Date.parse(value || '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

function historyEntryKey(entry = {}) {
  return JSON.stringify({
    timestamp: entry.timestamp || null,
    message: entry.message || '',
    type: entry.type || '',
    ai_tool: entry.ai_tool || '',
    branch: entry.branch || '',
    author: entry.author || '',
    status: entry.status || '',
    team_mode: entry.team_mode ?? null,
  });
}

module.exports = {
  sync,
  getSyncHubPath,
  buildLocalSnapshot,
  buildSyncReport,
  readHubSnapshot,
  writeHubSnapshot,
  applyHubSnapshot,
};
