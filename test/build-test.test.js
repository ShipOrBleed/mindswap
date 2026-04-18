const assert = require('assert');
const { createTempProject, cleanup } = require('./helpers');
const { detectLastStatus, parseTestOutput } = require('../src/build-test');
const fs = require('fs');
const path = require('path');

let dir;
function setup() { dir = createTempProject('build-test'); }
function teardown() { cleanup(dir); }

exports.test_parseTestOutput_jest_pass = () => {
  const output = 'Tests:  5 passed, 5 total\nTime: 1.2s';
  const result = parseTestOutput(output);
  assert.strictEqual(result.passed, 5);
  assert.strictEqual(result.failed, 0);
  assert.strictEqual(result.total, 5);
};

exports.test_parseTestOutput_jest_fail = () => {
  const output = 'Tests:  3 passed, 2 failed, 5 total';
  const result = parseTestOutput(output);
  assert.strictEqual(result.passed, 3);
  assert.strictEqual(result.failed, 2);
  assert.strictEqual(result.total, 5);
};

exports.test_parseTestOutput_pytest = () => {
  const output = '5 passed, 1 failed in 2.3s';
  const result = parseTestOutput(output);
  assert.strictEqual(result.passed, 5);
  assert.strictEqual(result.failed, 1);
};

exports.test_detectLastStatus_no_artifacts = () => {
  setup();
  try {
    const status = detectLastStatus(dir);
    assert.strictEqual(status.build, null);
    assert.strictEqual(status.test, null);
  } finally { teardown(); }
};

exports.test_detectLastStatus_detects_build_dir = () => {
  setup();
  try {
    fs.mkdirSync(path.join(dir, 'dist'));
    fs.writeFileSync(path.join(dir, 'dist', 'index.js'), '');
    const status = detectLastStatus(dir);
    assert.ok(status.build);
    assert.strictEqual(status.build.status, 'cached');
    assert.strictEqual(status.build.dir, 'dist');
  } finally { teardown(); }
};
