const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir } = require('../src/state');
const {
  buildRegistryManifest,
  buildRegistryReport,
  writeRegistryManifest,
  readRegistryManifest,
} = require('../src/registry');

let dir;

function setup() {
  dir = createTempProject('registry-test');
  ensureDataDir(dir);
}

function teardown() {
  cleanup(dir);
}

exports.test_buildRegistryManifest_includes_npm_and_metadata = () => {
  setup();
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join('/Users/zopdev/mindswap', 'package.json'), 'utf-8'));
    const manifest = buildRegistryManifest(packageJson);
    assert.strictEqual(manifest.name, packageJson.mcpName);
    assert.strictEqual(manifest.version, packageJson.version);
    assert.ok(manifest.description.length <= 100);
    assert.strictEqual(manifest.packages[0].identifier, packageJson.name);
    assert.strictEqual(manifest.packages[0].transport.type, 'stdio');
    assert.deepStrictEqual(manifest.packages[0].packageArguments, [
      { type: 'positional', value: 'mcp' },
    ]);
  } finally {
    teardown();
  }
};

exports.test_write_and_read_registry_manifest_roundtrip = () => {
  setup();
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join('/Users/zopdev/mindswap', 'package.json'), 'utf-8'));
    const { filePath, manifest } = writeRegistryManifest(dir, packageJson);
    assert.ok(fs.existsSync(filePath));
    const loaded = readRegistryManifest(dir);
    assert.strictEqual(loaded.name, manifest.name);
    assert.strictEqual(loaded.packages[0].identifier, packageJson.name);
  } finally {
    teardown();
  }
};

exports.test_buildRegistryReport_marks_ready_when_metadata_matches = () => {
  setup();
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join('/Users/zopdev/mindswap', 'package.json'), 'utf-8'));
    const manifest = buildRegistryManifest(packageJson);
    const report = buildRegistryReport(packageJson, manifest);
    assert.strictEqual(report.ready, true);
    assert.ok(report.checklist.length > 0);
  } finally {
    teardown();
  }
};

exports.test_registry_cli_outputs_ready_status = () => {
  setup();
  try {
    const output = execFileSync('node', ['/Users/zopdev/mindswap/bin/mindswap.js', 'registry', '--json'], {
      cwd: '/Users/zopdev/mindswap',
      encoding: 'utf-8',
    });
    const payload = JSON.parse(output.trim());
    assert.strictEqual(payload.package.mcpName, 'io.github.ShipOrBleed/mindswap');
    assert.ok(payload.manifest.name.includes('mindswap'));
  } finally {
    teardown();
  }
};
