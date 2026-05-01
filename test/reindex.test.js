const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir } = require('../src/state');
const { appendMemoryItem } = require('../src/memory');
const { reindex } = require('../src/reindex');

let dir;

function setup() {
  dir = createTempProject('reindex-test');
  ensureDataDir(dir);
  appendMemoryItem(dir, {
    type: 'assumption',
    tag: 'search',
    message: 'Index this memory for search',
  });
}

function teardown() {
  cleanup(dir);
}

exports.test_reindex_outputs_json_report = async () => {
  setup();
  try {
    const originalLog = console.log;
    const lines = [];
    console.log = (...args) => {
      lines.push(args.join(' '));
    };

    try {
      await reindex(dir, { scope: 'repo', json: true });
    } finally {
      console.log = originalLog;
    }

    const payload = JSON.parse(lines.join('\n'));
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.scope, 'repo');
    assert.ok(fs.existsSync(path.join(dir, '.mindswap', 'mindswap.db')));
  } finally {
    teardown();
  }
};
