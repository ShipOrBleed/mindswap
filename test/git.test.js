const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createTempProject, cleanup } = require('./helpers');
const { isGitRepo, getCurrentBranch, getRecentCommits, getAllChangedFiles, getDiffSummary, getLastCommitInfo } = require('../src/git');

let dir;

function setup() {
  dir = createTempProject('git-test');
}

function teardown() {
  cleanup(dir);
}

exports.test_isGitRepo_true_for_git_dir = () => {
  setup();
  try {
    assert.strictEqual(isGitRepo(dir), true);
  } finally {
    teardown();
  }
};

exports.test_isGitRepo_false_for_non_git_dir = () => {
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'nogit-'));
  try {
    assert.strictEqual(isGitRepo(tmpDir), false);
  } finally {
    cleanup(tmpDir);
  }
};

exports.test_getCurrentBranch_returns_main = () => {
  setup();
  try {
    const branch = getCurrentBranch(dir);
    assert.ok(
      branch === 'main' || branch === 'master',
      `expected main or master, got: ${branch}`
    );
  } finally {
    teardown();
  }
};

exports.test_getRecentCommits_returns_commits = () => {
  setup();
  try {
    const commits = getRecentCommits(dir, 5);
    assert.ok(commits.length >= 1, 'should have at least the init commit');
    assert.ok(commits[0].hash, 'commit should have hash');
    assert.ok(commits[0].message, 'commit should have message');
  } finally {
    teardown();
  }
};

exports.test_getAllChangedFiles_detects_new_file = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, 'newfile.txt'), 'hello');
    const changed = getAllChangedFiles(dir);
    assert.ok(changed.length >= 1, 'should detect new file');
    const newFile = changed.find(f => f.file === 'newfile.txt');
    assert.ok(newFile, 'should find newfile.txt');
  } finally {
    teardown();
  }
};

exports.test_getAllChangedFiles_detects_modified_file = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"modified"}');
    const changed = getAllChangedFiles(dir);
    const modified = changed.find(f => f.file === 'package.json');
    assert.ok(modified, 'should detect modified package.json');
  } finally {
    teardown();
  }
};

exports.test_getDiffSummary_shows_changes = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"changed"}');
    const summary = getDiffSummary(dir);
    assert.ok(summary.includes('package.json'), `should mention package.json, got: ${summary}`);
  } finally {
    teardown();
  }
};

exports.test_getLastCommitInfo_returns_data = () => {
  setup();
  try {
    const info = getLastCommitInfo(dir);
    assert.ok(info.hash, 'should have hash');
    assert.ok(info.message, 'should have message');
    assert.ok(info.time, 'should have time');
  } finally {
    teardown();
  }
};
