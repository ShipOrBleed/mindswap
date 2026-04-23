const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { detectAITool, getAllAIContextFiles } = require('../src/detect-ai');

let dir;
function setup() { dir = createTempProject('detect-ai-test'); }
function teardown() { cleanup(dir); }

exports.test_returns_null_when_no_ai_tools = () => {
  setup();
  try {
    assert.strictEqual(detectAITool(dir), null);
  } finally { teardown(); }
};

exports.test_detects_claude_code = () => {
  setup();
  try {
    fs.mkdirSync(path.join(dir, '.claude'));
    assert.ok(detectAITool(dir).includes('Claude Code'));
  } finally { teardown(); }
};

exports.test_detects_cursor = () => {
  setup();
  try {
    fs.mkdirSync(path.join(dir, '.cursor'));
    assert.ok(detectAITool(dir).includes('Cursor'));
  } finally { teardown(); }
};

exports.test_detects_codex_from_generated_file = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, 'CODEX.md'), '# Codex');
    assert.ok(detectAITool(dir).includes('Codex'));
  } finally { teardown(); }
};

exports.test_detects_multiple_tools = () => {
  setup();
  try {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.mkdirSync(path.join(dir, '.cursor'));
    const result = detectAITool(dir);
    assert.ok(result.includes('Claude Code'));
    assert.ok(result.includes('Cursor'));
  } finally { teardown(); }
};

exports.test_no_duplicate_detections = () => {
  setup();
  try {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude');
    const result = detectAITool(dir);
    assert.strictEqual((result.match(/Claude Code/g) || []).length, 1);
  } finally { teardown(); }
};

exports.test_getAllAIContextFiles = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# test');
    fs.writeFileSync(path.join(dir, 'CODEX.md'), '# test');
    fs.writeFileSync(path.join(dir, 'HANDOFF.md'), '# test');
    const files = getAllAIContextFiles(dir);
    assert.strictEqual(files['CLAUDE.md'], true);
    assert.strictEqual(files['CODEX.md'], true);
    assert.strictEqual(files['HANDOFF.md'], true);
    assert.strictEqual(files['AGENTS.md'], false);
  } finally { teardown(); }
};
