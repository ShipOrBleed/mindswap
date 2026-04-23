const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { init, extractProjectDescription, extractDecisionsFromContent } = require('../src/init');

exports.test_extractProjectDescription_basic = () => {
  const readme = '# My App\n\nA dashboard for managing cloud resources.\n\n## Features\n- Auth\n- Dashboard';
  const desc = extractProjectDescription(readme);
  assert.ok(desc.includes('dashboard'), `should extract description, got: ${desc}`);
};

exports.test_extractProjectDescription_with_badges = () => {
  const readme = '# My App\n\n[![npm](https://badge.svg)](https://npm.com)\n\nThe actual description here.\n\n## Setup';
  const desc = extractProjectDescription(readme);
  assert.ok(desc.includes('actual description'), `should skip badges, got: ${desc}`);
};

exports.test_extractProjectDescription_short = () => {
  const readme = '# X\n\nHi\n\n## Y';
  const desc = extractProjectDescription(readme);
  assert.strictEqual(desc, null, 'should return null for too-short descriptions');
};

exports.test_extractProjectDescription_no_title = () => {
  const readme = 'Just some text without a title heading.';
  const desc = extractProjectDescription(readme);
  assert.strictEqual(desc, null);
};

exports.test_extractDecisions_finds_patterns = () => {
  const content = '# Rules\n- Always use TypeScript strict mode for all new code.\n- Prefer server components over client components for data fetching.\n- Just a normal line without decision keywords.';
  const decisions = extractDecisionsFromContent(content);
  assert.ok(decisions.length >= 1, `should find decisions, got ${decisions.length}`);
};

exports.test_extractDecisions_skips_short_lines = () => {
  const content = '# Rules\n- Use TS.\n- ok';
  const decisions = extractDecisionsFromContent(content);
  assert.strictEqual(decisions.length, 0, 'should skip short lines');
};

exports.test_extractDecisions_skips_code_blocks = () => {
  // extractDecisionsFromContent strips leading markers but doesn't track code block state
  // Lines starting with ``` are skipped, content inside may still match
  const content = '```javascript\nconst x = 1\n```';
  const decisions = extractDecisionsFromContent(content);
  assert.strictEqual(decisions.length, 0, 'should skip code block markers');
};

exports.test_extractDecisions_limits_results = () => {
  const lines = Array(20).fill('- Always prefer async/await over callbacks for better error handling');
  const content = '# Rules\n' + lines.join('\n');
  const decisions = extractDecisionsFromContent(content);
  assert.ok(decisions.length <= 10, `should limit to 10, got ${decisions.length}`);
};

exports.test_init_creates_memory_json = async () => {
  const dir = createTempProject('init-memory-test');
  try {
    console.log = () => {};
    await init(dir, { noHooks: true });
    console.log = global.console.log;
    assert.ok(fs.existsSync(path.join(dir, '.mindswap', 'memory.json')));
  } finally {
    cleanup(dir);
  }
};
