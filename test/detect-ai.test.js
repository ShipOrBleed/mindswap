const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { detectAITool, getAllAIContextFiles } = require('../src/detect-ai');

let dir;

function setup() {
  dir = createTempProject('detect-ai-test');
}

function teardown() {
  cleanup(dir);
}

exports.test_returns_null_when_no_ai_tools = () => {
  setup();
  try {
    const result = detectAITool(dir);
    assert.strictEqual(result, null);
  } finally {
    teardown();
  }
};

exports.test_detects_claude_code = () => {
  setup();
  try {
    fs.mkdirSync(path.join(dir, '.claude'));
    const result = detectAITool(dir);
    assert.ok(result.includes('Claude Code'), `expected Claude Code, got: ${result}`);
  } finally {
    teardown();
  }
};

exports.test_detects_cursor = () => {
  setup();
  try {
    fs.mkdirSync(path.join(dir, '.cursor'));
    const result = detectAITool(dir);
    assert.ok(result.includes('Cursor'), `expected Cursor, got: ${result}`);
  } finally {
    teardown();
  }
};

exports.test_detects_multiple_tools = () => {
  setup();
  try {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.mkdirSync(path.join(dir, '.cursor'));
    const result = detectAITool(dir);
    assert.ok(result.includes('Claude Code'), 'should detect Claude Code');
    assert.ok(result.includes('Cursor'), 'should detect Cursor');
  } finally {
    teardown();
  }
};

exports.test_no_duplicate_detections = () => {
  setup();
  try {
    // Both .claude dir and CLAUDE.md — should still only say "Claude Code" once
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude');
    const result = detectAITool(dir);
    const count = (result.match(/Claude Code/g) || []).length;
    assert.strictEqual(count, 1, `expected 1 "Claude Code", got ${count} in: ${result}`);
  } finally {
    teardown();
  }
};

exports.test_getAllAIContextFiles_reports_correctly = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# test');
    fs.writeFileSync(path.join(dir, 'HANDOFF.md'), '# test');
    const files = getAllAIContextFiles(dir);
    assert.strictEqual(files['CLAUDE.md'], true);
    assert.strictEqual(files['HANDOFF.md'], true);
    assert.strictEqual(files['AGENTS.md'], false);
  } finally {
    teardown();
  }
};
