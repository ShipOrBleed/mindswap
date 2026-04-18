#!/usr/bin/env node

/**
 * Minimal test runner for relay-dev.
 * No external dependencies — uses Node's built-in assert.
 * Exit code 0 = all pass, 1 = failures.
 */

const fs = require('fs');
const path = require('path');

const testDir = __dirname;
const testFiles = fs.readdirSync(testDir)
  .filter(f => f.endsWith('.test.js'))
  .sort();

let totalPassed = 0;
let totalFailed = 0;
const failures = [];

async function runFile(file) {
  const filePath = path.join(testDir, file);
  const mod = require(filePath);

  const suiteName = file.replace('.test.js', '');
  const tests = Object.entries(mod).filter(([name]) => name.startsWith('test'));

  for (const [name, fn] of tests) {
    try {
      await fn();
      totalPassed++;
      console.log(`  ✓ ${suiteName}: ${name}`);
    } catch (err) {
      totalFailed++;
      const msg = `  ✗ ${suiteName}: ${name} — ${err.message}`;
      console.log(msg);
      failures.push({ suite: suiteName, test: name, error: err });
    }
  }
}

(async () => {
  console.log(`\nrelay-dev tests\n${'─'.repeat(40)}\n`);

  for (const file of testFiles) {
    await runFile(file);
  }

  console.log(`\n${'─'.repeat(40)}`);
  console.log(`  ${totalPassed} passed, ${totalFailed} failed\n`);

  if (failures.length > 0) {
    console.log('Failures:\n');
    for (const f of failures) {
      console.log(`  ${f.suite}/${f.test}:`);
      console.log(`    ${f.error.stack?.split('\n').slice(0, 3).join('\n    ') || f.error.message}\n`);
    }
    process.exit(1);
  }

  process.exit(0);
})();
