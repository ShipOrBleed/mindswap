const assert = require('assert');
const os = require('os');
const { createTempProject, cleanup } = require('./helpers');
const { resolveMemoryRoots, getGlobalProjectRoot, normalizeScope } = require('../src/scope');

let dir;

function setup() {
  dir = createTempProject('scope-test');
}

function teardown() {
  cleanup(dir);
}

exports.test_getGlobalProjectRoot_uses_home_directory = () => {
  assert.strictEqual(getGlobalProjectRoot(), os.homedir());
};

exports.test_normalizeScope_prefers_explicit_scope = () => {
  assert.strictEqual(normalizeScope({ scope: 'all' }), 'all');
};

exports.test_normalizeScope_maps_global_flag = () => {
  assert.strictEqual(normalizeScope({ global: true }), 'global');
};

exports.test_resolveMemoryRoots_returns_repo_root_by_default_inside_repo = () => {
  setup();
  try {
    const roots = resolveMemoryRoots(dir, {});
    assert.deepStrictEqual(roots, [dir]);
  } finally {
    teardown();
  }
};

exports.test_resolveMemoryRoots_supports_global_scope = () => {
  setup();
  try {
    const roots = resolveMemoryRoots(dir, { scope: 'global' });
    assert.deepStrictEqual(roots, [os.homedir()]);
  } finally {
    teardown();
  }
};

exports.test_resolveMemoryRoots_supports_all_scope = () => {
  setup();
  try {
    const roots = resolveMemoryRoots(dir, { scope: 'all' });
    assert.deepStrictEqual(roots, [dir, os.homedir()]);
  } finally {
    teardown();
  }
};
