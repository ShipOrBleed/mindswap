const fs = require('fs');
const path = require('path');

const RELAY_DIR = '.relay';
const STATE_FILE = 'state.json';
const DECISIONS_FILE = 'decisions.log';
const HISTORY_DIR = 'history';

function getRelayDir(projectRoot) {
  return path.join(projectRoot, RELAY_DIR);
}

function ensureRelayDir(projectRoot) {
  const relayDir = getRelayDir(projectRoot);
  const historyDir = path.join(relayDir, HISTORY_DIR);
  if (!fs.existsSync(relayDir)) fs.mkdirSync(relayDir, { recursive: true });
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
  return relayDir;
}

function getDefaultState() {
  return {
    version: '0.1.0',
    project: {
      name: '',
      root: '',
      tech_stack: [],
      package_manager: null,
    },
    current_task: {
      description: '',
      started_at: null,
      status: 'idle', // idle | in_progress | blocked | paused | completed
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
    session_history: [],
    decisions: [],
    modified_files: [],
    build_status: null,
    test_status: null,
  };
}

function readState(projectRoot) {
  const statePath = path.join(getRelayDir(projectRoot), STATE_FILE);
  if (!fs.existsSync(statePath)) return getDefaultState();
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  } catch {
    return getDefaultState();
  }
}

function writeState(projectRoot, state) {
  const relayDir = ensureRelayDir(projectRoot);
  const statePath = path.join(relayDir, STATE_FILE);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
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
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function addToHistory(projectRoot, entry) {
  const relayDir = ensureRelayDir(projectRoot);
  const historyDir = path.join(relayDir, HISTORY_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `checkpoint-${timestamp}.json`;
  fs.writeFileSync(
    path.join(historyDir, filename),
    JSON.stringify(entry, null, 2),
    'utf-8'
  );
  return filename;
}

function getHistory(projectRoot, limit = 10) {
  const historyDir = path.join(getRelayDir(projectRoot), HISTORY_DIR);
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
  RELAY_DIR,
  getRelayDir,
  ensureRelayDir,
  getDefaultState,
  readState,
  writeState,
  updateState,
  addToHistory,
  getHistory,
};
