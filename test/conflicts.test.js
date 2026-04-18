const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir } = require('../src/state');
const { checkConflicts, findAllConflicts, checkDepsVsDecisions } = require('../src/conflicts');

let dir;
function setup() {
  dir = createTempProject('conflicts-test');
  ensureDataDir(dir);
  fs.writeFileSync(path.join(dir, '.mindswap', 'decisions.log'), '# Decisions\n\n', 'utf-8');
}
function teardown() { cleanup(dir); }

function addDecision(text, tag = 'general') {
  const p = path.join(dir, '.mindswap', 'decisions.log');
  fs.appendFileSync(p, `[2026-01-01T00:00:00Z] [${tag}] ${text}\n`);
}

exports.test_no_conflicts_for_unrelated_decisions = () => {
  setup();
  try {
    addDecision('using PostgreSQL for the database');
    const conflicts = checkConflicts(dir, 'chose Tailwind for styling');
    assert.strictEqual(conflicts.length, 0);
  } finally { teardown(); }
};

exports.test_detects_not_using_vs_using = () => {
  setup();
  try {
    addDecision('NOT using Redis for caching');
    const conflicts = checkConflicts(dir, 'using Redis for sessions');
    assert.ok(conflicts.length > 0, 'should detect conflict');
    assert.ok(conflicts[0].reason.toLowerCase().includes('redis'));
  } finally { teardown(); }
};

exports.test_detects_chose_x_over_y_reversal = () => {
  setup();
  try {
    addDecision('chose Prisma over Drizzle');
    addDecision('chose Drizzle over Prisma');
    const conflicts = findAllConflicts(dir);
    assert.ok(conflicts.length > 0, 'should detect reversed choice');
  } finally { teardown(); }
};

exports.test_detects_chose_over_then_using = () => {
  setup();
  try {
    addDecision('chose JWT over sessions');
    const conflicts = checkConflicts(dir, 'using sessions for auth');
    assert.ok(conflicts.length > 0, 'should detect using rejected option');
  } finally { teardown(); }
};

exports.test_deps_vs_decisions_detects_conflict = () => {
  setup();
  try {
    addDecision('NOT using Redis — overkill for our scale');
    // package.json already has express and jest from helper
    // Add ioredis to trigger conflict
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    pkg.dependencies.ioredis = '^5.0.0';
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));

    const conflicts = checkDepsVsDecisions(dir);
    assert.ok(conflicts.length > 0, 'should detect Redis in deps vs NOT using Redis decision');
  } finally { teardown(); }
};

exports.test_deps_vs_decisions_no_false_positives = () => {
  setup();
  try {
    addDecision('using Express for the API');
    const conflicts = checkDepsVsDecisions(dir);
    assert.strictEqual(conflicts.length, 0, 'should not flag deps that match decisions');
  } finally { teardown(); }
};

exports.test_findAllConflicts_returns_empty_for_consistent = () => {
  setup();
  try {
    addDecision('using PostgreSQL');
    addDecision('using Prisma as ORM');
    addDecision('chose Next.js for frontend');
    const conflicts = findAllConflicts(dir);
    assert.strictEqual(conflicts.length, 0);
  } finally { teardown(); }
};
