const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createTempProject, cleanup } = require('./helpers');
const { parseNativeSessions, getSessionSummary } = require('../src/session-parser');

function withFakeHome(homeDir, fn) {
  const original = os.homedir;
  os.homedir = () => homeDir;
  try {
    return fn();
  } finally {
    os.homedir = original;
  }
}

function writeJsonl(filePath, entries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, entries.map(entry => JSON.stringify(entry)).join('\n'), 'utf-8');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

exports.test_parseNativeSessions_normalizes_claude_sessions = () => {
  const projectRoot = createTempProject('session-parser-claude');
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindswap-home-'));

  try {
    const relevantFile = path.join(homeDir, '.claude', 'projects', 'match-1', 'session.jsonl');
    writeJsonl(relevantFile, [
      { role: 'assistant', content: [{ type: 'text', text: 'Blocked on API key for the billing flow.' }] },
      { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: path.join(projectRoot, 'src', 'server.js') } }] },
      { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: `cd ${projectRoot} && npm test` } }] },
    ]);

    writeJsonl(path.join(homeDir, '.claude', 'projects', 'unrelated', 'session.jsonl'), [
      { role: 'assistant', content: [{ type: 'text', text: 'Unrelated notes for another repo.' }] },
    ]);

    withFakeHome(homeDir, () => {
      const sessions = parseNativeSessions(projectRoot);
      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0].tool, 'Claude Code');
      assert.ok(sessions[0].projectMatch.score > 0);
      assert.ok(sessions[0].summary.includes('Blocked on API key'));
      assert.ok(sessions[0].blockers[0].includes('Blocked on API key'));
      assert.ok(sessions[0].fileEdits[0].endsWith(path.join('src', 'server.js')));

      const summary = getSessionSummary(sessions);
      assert.ok(summary.includes('Recent AI sessions'));
      assert.ok(summary.includes('Blocker: Blocked on API key'));
      assert.ok(summary.includes('Commands run:'));
    });
  } finally {
    cleanup(projectRoot);
    cleanup(homeDir);
  }
};

exports.test_parseNativeSessions_normalizes_codex_sessions = () => {
  const projectRoot = createTempProject('session-parser-codex');
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindswap-home-'));

  try {
    const sessionPath = path.join(homeDir, '.codex', 'sessions', '2026-04-23-session.json');
    writeJson(sessionPath, {
      messages: [
        { role: 'assistant', content: `Investigating ${projectRoot} and fixing the parser.` },
        { role: 'assistant', content: 'Command: cd ' + projectRoot + ' && cargo test' },
      ],
    });

    withFakeHome(homeDir, () => {
      const sessions = parseNativeSessions(projectRoot);
      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0].tool, 'Codex');
      assert.ok(sessions[0].projectMatch.score > 0);
      assert.ok(sessions[0].summary.includes('Investigating'));
      assert.ok(sessions[0].messages.length > 0);
      assert.ok(getSessionSummary(sessions).includes('Codex'));
    });
  } finally {
    cleanup(projectRoot);
    cleanup(homeDir);
  }
};
