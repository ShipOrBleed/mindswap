const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./state');

const MEMORY_FILE = 'memory.json';
const MEMORY_TYPES = new Set(['decision', 'blocker', 'assumption', 'question', 'resolution']);
const MEMORY_STATUSES = new Set(['open', 'resolved', 'archived']);

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
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
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
  const status = normalizeStatus(item.status || (normalizedType === 'resolution' ? 'resolved' : 'open'));
  const resolvedAt = status === 'resolved'
    ? (item.resolved_at || now)
    : (item.resolved_at || null);
  const archivedAt = status === 'archived'
    ? (item.archived_at || now)
    : (item.archived_at || null);
  const entry = {
    id: item.id || generateId(),
    type: normalizedType,
    tag: item.tag || 'general',
    message: item.message,
    status,
    created_at: now,
    updated_at: item.updated_at || now,
    resolved_at: resolvedAt,
    archived_at: archivedAt,
    source: item.source || 'cli',
    author: item.author || null,
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
  if (opts.id) {
    const ids = Array.isArray(opts.id) ? opts.id : [opts.id];
    items = items.filter(item => ids.includes(item.id));
  }
  if (opts.status) {
    items = items.filter(item => item.status === opts.status);
  }
  if (opts.source) {
    const sources = Array.isArray(opts.source) ? opts.source : [opts.source];
    items = items.filter(item => sources.includes(item.source));
  }
  if (opts.author) {
    const authors = Array.isArray(opts.author) ? opts.author : [opts.author];
    items = items.filter(item => authors.includes(item.author));
  }
  if (opts.created_after) {
    const after = timestampValue(opts.created_after);
    items = items.filter(item => timestampValue(item.created_at) >= after);
  }
  if (opts.created_before) {
    const before = timestampValue(opts.created_before);
    items = items.filter(item => timestampValue(item.created_at) <= before);
  }
  if (!opts.includeArchived) {
    items = items.filter(item => item.status !== 'archived');
  }
  if (opts.limit) {
    const limit = Number(opts.limit);
    if (Number.isFinite(limit) && limit > 0) {
      items = items.slice(-limit);
    }
  }

  return items;
}

function getOpenMemoryItems(projectRoot, type, limit = 10) {
  return getMemoryItems(projectRoot, { type, status: 'open', limit });
}

function getRecentMemoryItems(projectRoot, limit = 20) {
  return getMemoryItems(projectRoot, { limit });
}

function getMemoryItemById(projectRoot, id) {
  if (!id) return null;
  return getMemoryItems(projectRoot, { includeArchived: true }).find(item => item.id === id) || null;
}

function updateMemoryItem(projectRoot, id, updates = {}) {
  const memory = readMemory(projectRoot);
  const index = memory.items.findIndex(item => item.id === id);
  if (index === -1) return null;

  const current = memory.items[index];
  const next = { ...current };
  const now = updates.updated_at || new Date().toISOString();

  if (updates.type) next.type = normalizeType(updates.type);
  if (updates.tag !== undefined) next.tag = updates.tag;
  if (updates.message !== undefined) next.message = updates.message;
  if (updates.source !== undefined) next.source = updates.source;
  if (updates.author !== undefined) next.author = updates.author;
  if (updates.metadata !== undefined) {
    next.metadata = mergeMetadata(current.metadata, updates.metadata);
  }
  if (updates.status !== undefined) {
    next.status = normalizeStatus(updates.status, current.status);
  }
  if (updates.resolved_at !== undefined) {
    next.resolved_at = updates.resolved_at;
  }
  if (updates.archived_at !== undefined) {
    next.archived_at = updates.archived_at;
  }

  if (next.status === 'resolved' && !next.resolved_at) {
    next.resolved_at = now;
  }
  if (next.status === 'archived' && !next.archived_at) {
    next.archived_at = now;
  }
  if (next.status !== 'resolved' && updates.resolved_at === null) {
    next.resolved_at = null;
  }
  if (next.status !== 'archived' && updates.archived_at === null) {
    next.archived_at = null;
  }

  next.updated_at = now;
  memory.items[index] = next;
  writeMemory(projectRoot, memory);
  return next;
}

function resolveMemoryItem(projectRoot, id, updates = {}) {
  const resolvedAt = updates.resolved_at || new Date().toISOString();
  return updateMemoryItem(projectRoot, id, {
    ...updates,
    status: 'resolved',
    resolved_at: resolvedAt,
  });
}

function archiveMemoryItem(projectRoot, id, updates = {}) {
  const archivedAt = updates.archived_at || new Date().toISOString();
  return updateMemoryItem(projectRoot, id, {
    ...updates,
    status: 'archived',
    archived_at: archivedAt,
  });
}

function deleteMemoryItem(projectRoot, id, opts = {}) {
  const memory = readMemory(projectRoot);
  const index = memory.items.findIndex(item => item.id === id);
  if (index === -1) return null;

  const item = memory.items[index];
  if (opts.hard) {
    memory.items.splice(index, 1);
    writeMemory(projectRoot, memory);
    return item;
  }

  return archiveMemoryItem(projectRoot, id, {
    archived_at: opts.archived_at || new Date().toISOString(),
  });
}

function listMemoryItems(projectRoot, opts = {}) {
  return getMemoryItems(projectRoot, opts);
}

function normalizeType(type) {
  return MEMORY_TYPES.has(type) ? type : 'decision';
}

function normalizeStatus(status, fallback = 'open') {
  return MEMORY_STATUSES.has(status) ? status : fallback;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function timestampValue(value) {
  const parsed = Date.parse(value || '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

function mergeMetadata(existing, incoming) {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    return incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? { ...incoming } : {};
  }
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return { ...existing };
  }
  return { ...existing, ...incoming };
}

module.exports = {
  MEMORY_FILE,
  MEMORY_TYPES,
  MEMORY_STATUSES,
  getMemoryPath,
  getDefaultMemory,
  ensureMemory,
  readMemory,
  writeMemory,
  appendMemoryItem,
  getMemoryItems,
  getOpenMemoryItems,
  getRecentMemoryItems,
  getMemoryItemById,
  updateMemoryItem,
  resolveMemoryItem,
  archiveMemoryItem,
  deleteMemoryItem,
  listMemoryItems,
  normalizeType,
  normalizeStatus,
};
