const assert = require('assert');
const { buildNarrative, buildCompactNarrative, calculateQualityScore, detectWorkPatterns, summarizeFiles } = require('../src/narrative');

const mockState = {
  project: { name: 'test-app', language: 'typescript', framework: 'Next.js', tech_stack: ['node.js', 'next.js'], package_manager: 'npm' },
  current_task: { description: 'build auth', status: 'in_progress', blocker: null, next_steps: ['add JWT'], started_at: '2026-01-01' },
  last_checkpoint: { timestamp: new Date().toISOString(), message: 'auth wip', ai_tool: 'Claude Code' },
  test_status: { status: 'pass', passed: 10, failed: 0, total: 10 },
};

const mockLive = {
  branch: 'feat/auth',
  changedFiles: [{ status: 'modified', file: 'src/auth.ts' }, { status: 'new', file: 'src/login.ts' }],
  recentCommits: [{ hash: 'abc', message: 'add auth middleware' }],
  decisions: ['[2026-01-01] [auth] chose JWT over sessions'],
  history: [],
};

exports.test_buildNarrative_includes_project = () => {
  const result = buildNarrative(mockState, mockLive);
  assert.ok(result.includes('test-app'), 'should include project name');
  assert.ok(result.includes('typescript'), 'should include language');
};

exports.test_buildNarrative_includes_task = () => {
  const result = buildNarrative(mockState, mockLive);
  assert.ok(result.includes('build auth'), 'should include task');
};

exports.test_buildNarrative_includes_decisions = () => {
  const result = buildNarrative(mockState, mockLive);
  assert.ok(result.includes('JWT'), 'should include decisions');
};

exports.test_buildNarrative_includes_test_status = () => {
  const result = buildNarrative(mockState, mockLive);
  assert.ok(result.includes('10'), 'should include test count');
};

exports.test_buildNarrative_idle_task = () => {
  const idleState = { ...mockState, current_task: { description: '', status: 'idle', next_steps: [] } };
  const result = buildNarrative(idleState, mockLive);
  assert.ok(result.includes('idle'), 'should mention idle');
};

exports.test_buildCompactNarrative_short = () => {
  const result = buildCompactNarrative(mockState, mockLive);
  assert.ok(result.length < 500, `should be compact, got ${result.length} chars`);
  assert.ok(result.includes('test-app'), 'should include project');
  assert.ok(result.includes('TASK:'), 'should have TASK prefix');
};

exports.test_detectWorkPatterns_auth = () => {
  const patterns = detectWorkPatterns([{ file: 'src/auth.ts' }, { file: 'src/login.ts' }]);
  assert.ok(patterns.includes('authentication'), 'should detect auth pattern');
};

exports.test_detectWorkPatterns_tests = () => {
  const patterns = detectWorkPatterns([{ file: 'test/auth.test.ts' }]);
  assert.ok(patterns.includes('tests'), 'should detect test pattern');
};

exports.test_detectWorkPatterns_api = () => {
  const patterns = detectWorkPatterns([{ file: 'src/api/routes.ts' }, { file: 'src/handler/user.go' }]);
  assert.ok(patterns.includes('API endpoints'), 'should detect API pattern');
};

exports.test_summarizeFiles_counts = () => {
  const result = summarizeFiles([
    { status: 'new', file: 'a.ts' },
    { status: 'modified', file: 'b.ts' },
    { status: 'deleted', file: 'c.ts' },
  ]);
  assert.ok(result.includes('3'), 'should count total');
  assert.ok(result.includes('1 new'), 'should count new');
  assert.ok(result.includes('1 modified'), 'should count modified');
  assert.ok(result.includes('1 deleted'), 'should count deleted');
};

exports.test_summarizeFiles_empty = () => {
  const result = summarizeFiles([]);
  assert.strictEqual(result, null, 'should return null for empty');
};

exports.test_qualityScore_full_context = () => {
  const quality = calculateQualityScore(mockState, mockLive);
  assert.ok(quality.score >= 70, `should score high with full context, got ${quality.score}`);
  assert.ok(['A', 'B'].includes(quality.grade), `should grade A or B, got ${quality.grade}`);
};

exports.test_qualityScore_empty_context = () => {
  const emptyState = { project: {}, current_task: { status: 'idle' }, last_checkpoint: {}, test_status: null };
  const emptyLive = { branch: null, changedFiles: [], recentCommits: [], decisions: [], history: [] };
  const quality = calculateQualityScore(emptyState, emptyLive);
  assert.ok(quality.score < 30, `should score low with empty context, got ${quality.score}`);
  assert.ok(quality.missing.length > 0, 'should list missing items');
};

exports.test_qualityScore_has_grade = () => {
  const quality = calculateQualityScore(mockState, mockLive);
  assert.ok(['A', 'B', 'C', 'D', 'F'].includes(quality.grade));
  assert.ok(Array.isArray(quality.present));
  assert.ok(Array.isArray(quality.missing));
};
