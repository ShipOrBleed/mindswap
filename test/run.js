#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const testDir = __dirname;
const testFiles = fs.readdirSync(testDir)
  .filter(f => f.endsWith('.test.js'))
  .sort();

let totalPassed = 0;
let totalFailed = 0;
const failures = [];

// Save original console.log so tests can't break the runner
const originalLog = console.log.bind(console);

async function runFile(file) {
  const filePath = path.join(testDir, file);
  let mod;
  try {
    mod = require(filePath);
  } catch (err) {
    totalFailed++;
    const msg = `  ✗ ${file}: LOAD ERROR — ${err.message}`;
    originalLog(msg);
    failures.push({ suite: file, test: 'load', error: err });
    return;
  }

  const suiteName = file.replace('.test.js', '');
  const tests = Object.entries(mod).filter(([name]) => name.startsWith('test'));

  for (const [name, fn] of tests) {
    // Restore console.log before each test (in case previous test broke it)
    console.log = originalLog;
    try {
      await fn();
      totalPassed++;
      originalLog(`  ✓ ${suiteName}: ${name}`);
    } catch (err) {
      totalFailed++;
      const msg = `  ✗ ${suiteName}: ${name} — ${err.message}`;
      originalLog(msg);
      failures.push({ suite: suiteName, test: name, error: err });
    }
    // Always restore console.log after each test
    console.log = originalLog;
  }
}

(async () => {
  originalLog(`\nmindswap tests\n${'─'.repeat(40)}\n`);

  for (const file of testFiles) {
    await runFile(file);
  }

  originalLog(`\n${'─'.repeat(40)}`);
  originalLog(`  ${totalPassed} passed, ${totalFailed} failed\n`);

  if (failures.length > 0) {
    originalLog('Failures:\n');
    for (const f of failures) {
      originalLog(`  ${f.suite}/${f.test}:`);
      originalLog(`    ${f.error.stack?.split('\n').slice(0, 3).join('\n    ') || f.error.message}\n`);
    }
    process.exit(1);
  }

  process.exit(0);
})();
