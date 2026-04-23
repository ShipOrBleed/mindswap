const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./state');

const MEMORY_FILE = 'memory.json';
const MEMORY_TYPES = new Set(['decision', 'blocker', 'assumption', 'question', 'resolution']);

function getMemoryPath(projectRoot) {
  return path.join(getDataDir(projectRoot), MEMORY_FILE);
}

function getDefaultMemory() {
  return {
    version: '1.0.0',
    items: [],
  };
}

function ensureMemory(projectRoot) {
  const memoryPath = getMemoryPath(projectRoot);
  if (!fs.existsSync(memoryPath)) {
    fs.writeFileSync(memoryPath, JSON.stringify(getDefaultMemory(), null, 2), 'utf-8');
  }
  return memoryPath;
}

function readMemory(projectRoot) {
  const memoryPath = getMemoryPath(projectRoot);
  if (!fs.existsSync(memoryPath)) return getDefaultMemory();
  try {
    const data = JSON.parse(fs.readFileSync(memoryPath, 'utf-8'));
    return {
      version: data.version || '1.0.0',
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch {
    return getDefaultMemory();
  }
}

function writeMemory(projectRoot, memory) {
  const memoryPath = ensureMemory(projectRoot);
  fs.writeFileSync(memoryPath, JSON.stringify(memory, null, 2), 'utf-8');
}

function appendMemoryItem(projectRoot, item) {
  const memory = readMemory(projectRoot);
  const normalizedType = normalizeType(item.type);
  const now = item.created_at || new Date().toISOString();
  const entry = {
    id: item.id || generateId(),
    type: normalizedType,
    tag: item.tag || 'general',
    message: item.message,
    status: item.status || (normalizedType === 'resolution' ? 'resolved' : 'open'),
    created_at: now,
    resolved_at: item.resolved_at || null,
    source: item.source || 'cli',
    metadata: item.metadata || {},
  };

  memory.items.push(entry);
  writeMemory(projectRoot, memory);
  return entry;
}

function getMemoryItems(projectRoot, opts = {}) {
  const memory = readMemory(projectRoot);
  let items = memory.items.slice();

  if (opts.type) {
    const types = Array.isArray(opts.type) ? opts.type : [opts.type];
    items = items.filter(item => types.includes(item.type));
  }
  if (opts.status) {
    items = items.filter(item => item.status === opts.status);
  }
  if (opts.limit) {
    items = items.slice(-opts.limit);
  }

  return items;
}

function getOpenMemoryItems(projectRoot, type, limit = 10) {
  return getMemoryItems(projectRoot, { type, status: 'open', limit });
}

function getRecentMemoryItems(projectRoot, limit = 20) {
  return getMemoryItems(projectRoot, { limit });
}

function normalizeType(type) {
  return MEMORY_TYPES.has(type) ? type : 'decision';
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

module.exports = {
  MEMORY_FILE,
  MEMORY_TYPES,
  getMemoryPath,
  getDefaultMemory,
  ensureMemory,
  readMemory,
  writeMemory,
  appendMemoryItem,
  getMemoryItems,
  getOpenMemoryItems,
  getRecentMemoryItems,
  normalizeType,
};
