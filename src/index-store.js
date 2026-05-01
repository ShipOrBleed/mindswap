const fs = require('fs');
const path = require('path');
const { getDataDir } = require('./state');
const { readMemory } = require('./memory');
const { createProjectSnapshot } = require('./project-snapshot');
const { getGlobalProjectRoot, normalizeScope } = require('./scope');

let sqlite = null;
let sqliteLoaded = false;

function getSqlite() {
  if (sqliteLoaded) return sqlite;
  sqliteLoaded = true;

  const originalEmitWarning = process.emitWarning;
  process.emitWarning = function emitWarningWithoutSqliteNoise(warning, ...args) {
    const message = typeof warning === 'string' ? warning : warning?.message || '';
    const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
    if (type === 'ExperimentalWarning' && /SQLite/i.test(message)) return;
    return originalEmitWarning.call(process, warning, ...args);
  };

  try {
    sqlite = require('node:sqlite');
  } catch {
    sqlite = null;
  } finally {
    process.emitWarning = originalEmitWarning;
  }

  return sqlite;
}

function isSqliteAvailable() {
  const runtime = getSqlite();
  return Boolean(runtime && runtime.DatabaseSync);
}

function getIndexDbPath(projectRoot) {
  return path.join(getDataDir(projectRoot), 'mindswap.db');
}

function rebuildSearchIndex(projectRoot, opts = {}) {
  if (!isSqliteAvailable()) {
    return {
      ok: false,
      indexed: 0,
      scope: normalizeScope(opts),
      db_path: null,
      reason: 'SQLite runtime is not available in this Node.js environment.',
    };
  }

  const scope = normalizeScope(opts);
  const dbPath = getIndexDbPath(projectRoot);
  const db = openIndexDb(dbPath);
  try {
    db.exec('DELETE FROM documents;');
    let indexed = 0;

    if (scope === 'repo' || scope === 'all') {
      indexed += indexRepoDocuments(db, projectRoot);
    }

    if (scope === 'global' || scope === 'all') {
      indexed += indexGlobalDocuments(db);
    }

    return {
      ok: true,
      indexed,
      scope,
      db_path: dbPath,
    };
  } finally {
    db.close();
  }
}

function searchIndexedEntries(projectRoot, query, opts = {}) {
  if (!isSqliteAvailable()) return [];
  const dbPath = getIndexDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) return [];

  const scope = normalizeScope(opts);
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const db = openIndexDb(dbPath);
  try {
    const rows = db.prepare('SELECT key, scope, type, source, content FROM documents').all();
    return rows
      .filter(row => scope === 'all' || row.scope === scope)
      .map(row => ({ ...row, score: scoreRow(row.content, tokens) }))
      .filter(row => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Number(opts.limit) || 10);
  } finally {
    db.close();
  }
}

function openIndexDb(dbPath) {
  const { DatabaseSync } = getSqlite();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      key TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      type TEXT NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL
    );
  `);
  return db;
}

function indexRepoDocuments(db, projectRoot) {
  const snapshot = createProjectSnapshot(projectRoot, { historyLimit: 50, recentCommitLimit: 5 });
  let count = 0;

  for (const [index, line] of snapshot.decisions.entries()) {
    insertDocument(db, {
      key: `repo:decision:${index}:${line}`,
      scope: 'repo',
      type: 'decision',
      source: 'decisions.log',
      content: line,
    });
    count += 1;
  }

  for (const [index, entry] of snapshot.history.entries()) {
    insertDocument(db, {
      key: `repo:history:${index}:${entry.timestamp || ''}:${entry.message || ''}`,
      scope: 'repo',
      type: 'history',
      source: 'history',
      content: entry.message || '',
    });
    count += 1;
  }

  for (const item of snapshot.memory?.items || []) {
    insertDocument(db, {
      key: `repo:memory:${item.id || `${item.type}:${item.message}`}`,
      scope: 'repo',
      type: `memory:${item.type}`,
      source: 'memory',
      content: item.message || '',
    });
    count += 1;
  }

  if (snapshot.state?.current_task?.description) {
    insertDocument(db, {
      key: `repo:task:${snapshot.state.current_task.description}`,
      scope: 'repo',
      type: 'task',
      source: 'state.current_task',
      content: snapshot.state.current_task.description,
    });
    count += 1;
  }

  if (snapshot.state?.current_task?.blocker) {
    insertDocument(db, {
      key: `repo:blocker:${snapshot.state.current_task.blocker}`,
      scope: 'repo',
      type: 'blocker',
      source: 'state.current_task',
      content: snapshot.state.current_task.blocker,
    });
    count += 1;
  }

  return count;
}

function indexGlobalDocuments(db) {
  const memory = readMemory(getGlobalProjectRoot());
  let count = 0;
  for (const item of memory.items || []) {
    insertDocument(db, {
      key: `global:memory:${item.id || `${item.type}:${item.message}`}`,
      scope: 'global',
      type: `memory:${item.type}`,
      source: 'global-memory',
      content: item.message || '',
    });
    count += 1;
  }
  return count;
}

function insertDocument(db, doc) {
  db.prepare(`
    INSERT OR REPLACE INTO documents (key, scope, type, source, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(doc.key, doc.scope, doc.type, doc.source, doc.content);
}

function tokenize(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map(token => token.trim())
    .filter(Boolean);
}

function scoreRow(content, tokens) {
  const haystack = String(content || '').toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

module.exports = {
  isSqliteAvailable,
  getIndexDbPath,
  rebuildSearchIndex,
  searchIndexedEntries,
};
