const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir } = require('../src/state');
const {
  ensureMemory,
  appendMemoryItem,
  readMemory,
  getOpenMemoryItems,
  getMemoryItemById,
  getMemoryItems,
  updateMemoryItem,
  resolveMemoryItem,
  archiveMemoryItem,
  deleteMemoryItem,
} = require('../src/memory');

let dir;
function setup() {
  dir = createTempProject('memory-test');
  ensureDataDir(dir);
  ensureMemory(dir);
}
function teardown() { cleanup(dir); }

exports.test_ensureMemory_creates_memory_json = () => {
  setup();
  try {
    assert.ok(fs.existsSync(path.join(dir, '.mindswap', 'memory.json')));
  } finally { teardown(); }
};

exports.test_appendMemoryItem_persists_items = () => {
  setup();
  try {
    appendMemoryItem(dir, { type: 'question', tag: 'auth', message: 'Should we rotate refresh tokens?' });
    const memory = readMemory(dir);
    assert.strictEqual(memory.items.length, 1);
    assert.strictEqual(memory.items[0].type, 'question');
  } finally { teardown(); }
};

exports.test_getOpenMemoryItems_filters_by_type = () => {
  setup();
  try {
    appendMemoryItem(dir, { type: 'blocker', message: 'Webhook secret not provisioned' });
    appendMemoryItem(dir, { type: 'assumption', message: 'Using a single region for MVP' });
    const blockers = getOpenMemoryItems(dir, 'blocker', 5);
    assert.strictEqual(blockers.length, 1);
    assert.strictEqual(blockers[0].message, 'Webhook secret not provisioned');
  } finally { teardown(); }
};

exports.test_memory_crud_lifecycle = () => {
  setup();
  try {
    const blocker = appendMemoryItem(dir, {
      type: 'blocker',
      tag: 'auth',
      message: 'Waiting on auth review',
      author: 'Codex',
      source: 'mcp',
      metadata: { severity: 'high' },
    });

    const updated = updateMemoryItem(dir, blocker.id, {
      message: 'Waiting on auth review from security',
      metadata: { severity: 'critical', owner: 'platform' },
      author: 'Claude',
    });

    assert.strictEqual(updated.message, 'Waiting on auth review from security');
    assert.strictEqual(updated.author, 'Claude');
    assert.strictEqual(updated.metadata.severity, 'critical');
    assert.strictEqual(updated.metadata.owner, 'platform');
    assert.ok(updated.updated_at);

    const resolved = resolveMemoryItem(dir, blocker.id, { message: 'Auth review approved' });
    assert.strictEqual(resolved.status, 'resolved');
    assert.ok(resolved.resolved_at);

    const item = getMemoryItemById(dir, blocker.id);
    assert.strictEqual(item.status, 'resolved');
    assert.strictEqual(item.message, 'Auth review approved');

    const archived = archiveMemoryItem(dir, blocker.id, { message: 'Move to history' });
    assert.strictEqual(archived.status, 'archived');
    assert.ok(archived.archived_at);

    const archiveList = getMemoryItems(dir, { status: 'archived', includeArchived: true });
    assert.strictEqual(archiveList.length, 1);

    const hardDeleted = deleteMemoryItem(dir, blocker.id, { hard: true });
    assert.ok(hardDeleted);
    assert.strictEqual(getMemoryItemById(dir, blocker.id), null);
  } finally {
    teardown();
  }
};

exports.test_memory_filters_support_author_and_dates = () => {
  setup();
  try {
    const first = appendMemoryItem(dir, {
      type: 'question',
      tag: 'ux',
      message: 'Should we add keyboard shortcuts?',
      author: 'Cursor',
      created_at: '2026-04-20T10:00:00.000Z',
    });
    appendMemoryItem(dir, {
      type: 'question',
      tag: 'ux',
      message: 'Should we add onboarding tooltips?',
      author: 'Claude',
      created_at: '2026-04-23T10:00:00.000Z',
    });

    const byAuthor = getMemoryItems(dir, { author: 'Cursor' });
    assert.strictEqual(byAuthor.length, 1);
    assert.strictEqual(byAuthor[0].id, first.id);

    const after = getMemoryItems(dir, { created_after: '2026-04-21T00:00:00.000Z' });
    assert.strictEqual(after.length, 1);
    assert.strictEqual(after[0].author, 'Claude');
  } finally {
    teardown();
  }
};

exports.test_cli_memory_add_treats_free_text_as_message = () => {
  setup();
  try {
    execFileSync('node', ['/Users/zopdev/mindswap/bin/mindswap.js', 'init'], { cwd: dir, stdio: 'pipe' });
    const output = execFileSync('node', ['/Users/zopdev/mindswap/bin/mindswap.js', 'memory', 'add', '--type', 'blocker', '--json', 'Waiting on auth review'], {
      cwd: dir,
      encoding: 'utf-8',
    });
    const payload = JSON.parse(output.trim());
    assert.strictEqual(payload.item.message, 'Waiting on auth review');
    assert.strictEqual(payload.item.type, 'blocker');
  } finally {
    teardown();
  }
};

exports.test_cli_json_output_does_not_emit_sqlite_warning = () => {
  setup();
  try {
    execFileSync('node', ['/Users/zopdev/mindswap/bin/mindswap.js', 'init'], { cwd: dir, stdio: 'pipe' });
    const result = spawnSync('node', ['/Users/zopdev/mindswap/bin/mindswap.js', 'memory', 'list', '--json'], {
      cwd: dir,
      encoding: 'utf-8',
    });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stderr.trim(), '');
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.action, 'list');
  } finally {
    teardown();
  }
};
