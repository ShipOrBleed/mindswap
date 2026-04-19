const fs = require('fs');
const path = require('path');

const DATA_DIR = '.mindswap';
const STATE_FILE = 'state.json';
const DECISIONS_FILE = 'decisions.log';
const HISTORY_DIR = 'history';
const BRANCHES_DIR = 'branches';

function getDataDir(projectRoot) {
  return path.join(projectRoot, DATA_DIR);
}

function ensureDataDir(projectRoot) {
  const dataDir = getDataDir(projectRoot);
  const historyDir = path.join(dataDir, HISTORY_DIR);
  const branchesDir = path.join(dataDir, BRANCHES_DIR);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
  if (!fs.existsSync(branchesDir)) fs.mkdirSync(branchesDir, { recursive: true });
  return dataDir;
}

function getDefaultState() {
  return {
    version: '1.0.0',
    project: {
      name: '',
      root: '',
      tech_stack: [],
      package_manager: null,
    },
    current_task: {
      description: '',
      started_at: null,
      status: 'idle',
      blocker: null,
      next_steps: [],
    },
    last_checkpoint: {
      timestamp: null,
      message: '',
      ai_tool: null,
      files_changed: [],
      git_branch: null,
      git_diff_summary: '',
    },
    build_status: null,
    test_status: null,
    session_history: [],
    decisions: [],
    modified_files: [],
  };
}

// ─── Branch-aware state ───

function sanitizeBranch(branch) {
  return branch.replace(/[/\\:*?"<>|]/g, '_');
}

function getCurrentBranchSafe(projectRoot) {
  try {
    const { execSync } = require('child_process');
    return execSync('git branch --show-current', {
      cwd: projectRoot, stdio: 'pipe', encoding: 'utf-8',
    }).trim() || null;
  } catch {
    return null;
  }
}

function getBranchStatePath(projectRoot, branch) {
  return path.join(getDataDir(projectRoot), BRANCHES_DIR, `${sanitizeBranch(branch)}.json`);
}

function readState(projectRoot) {
  const dataDir = getDataDir(projectRoot);
  const mainStatePath = path.join(dataDir, STATE_FILE);

  // Try branch-specific state first
  const branch = getCurrentBranchSafe(projectRoot);
  if (branch) {
    const branchPath = getBranchStatePath(projectRoot, branch);
    if (fs.existsSync(branchPath)) {
      try {
        return JSON.parse(fs.readFileSync(branchPath, 'utf-8'));
      } catch (err) {
        // Corrupt branch state — warn and fall through to main
        try { process.stderr.write(`mindswap: corrupt branch state (${branch}), using main state\n`); } catch {}
      }
    }
  }

  // Fall back to main state
  if (!fs.existsSync(mainStatePath)) return getDefaultState();
  try {
    return JSON.parse(fs.readFileSync(mainStatePath, 'utf-8'));
  } catch (err) {
    try { process.stderr.write('mindswap: corrupt state.json, using defaults\n'); } catch {}
    return getDefaultState();
  }
}

function writeState(projectRoot, state) {
  const dataDir = ensureDataDir(projectRoot);
  const mainStatePath = path.join(dataDir, STATE_FILE);

  // Always write to main state.json (current active state)
  fs.writeFileSync(mainStatePath, JSON.stringify(state, null, 2), 'utf-8');

  // Also write to branch-specific file
  const branch = getCurrentBranchSafe(projectRoot);
  if (branch) {
    const branchPath = getBranchStatePath(projectRoot, branch);
    fs.writeFileSync(branchPath, JSON.stringify(state, null, 2), 'utf-8');
  }
}

function updateState(projectRoot, updates) {
  const state = readState(projectRoot);
  const merged = deepMerge(state, updates);
  writeState(projectRoot, merged);
  return merged;
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    // Explicit null/undefined = clear the field
    if (val === null || val === undefined) {
      result[key] = val;
    } else if (
      typeof val === 'object' &&
      !Array.isArray(val) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], val);
    } else {
      result[key] = val;
    }
  }
  return result;
}

// ─── History ───

function randomSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

function addToHistory(projectRoot, entry) {
  const dataDir = ensureDataDir(projectRoot);
  const historyDir = path.join(dataDir, HISTORY_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `checkpoint-${timestamp}-${randomSuffix()}.json`;
  fs.writeFileSync(
    path.join(historyDir, filename),
    JSON.stringify(entry, null, 2),
    'utf-8'
  );
  return filename;
}

function getHistory(projectRoot, limit = 10) {
  const historyDir = path.join(getDataDir(projectRoot), HISTORY_DIR);
  if (!fs.existsSync(historyDir)) return [];
  const files = fs.readdirSync(historyDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit);
  return files.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(historyDir, f), 'utf-8'));
    } catch {
      return null;
    }
  }).filter(Boolean);
}

module.exports = {
  DATA_DIR,
  getDataDir,
  ensureDataDir,
  getDefaultState,
  readState,
  writeState,
  updateState,
  addToHistory,
  getHistory,
  sanitizeBranch,
  getCurrentBranchSafe,
};
