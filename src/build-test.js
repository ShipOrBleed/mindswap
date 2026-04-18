const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Detect build/test status by running the project's test/build commands.
 * Returns { build: { status, output }, test: { status, output, passed, failed } }
 */
function runChecks(projectRoot, opts = {}) {
  const result = { build: null, test: null };
  const pkg = readPackageJson(projectRoot);

  if (opts.test !== false) {
    result.test = runTests(projectRoot, pkg);
  }
  if (opts.build) {
    result.build = runBuild(projectRoot, pkg);
  }

  return result;
}

function runTests(projectRoot, pkg) {
  const testCmd = getTestCommand(projectRoot, pkg);
  if (!testCmd) return { status: 'no_test_runner', output: '' };

  const timeout = getConfigTimeout(projectRoot);
  try {
    const output = execSync(testCmd, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout,
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
    });

    const parsed = parseTestOutput(output);
    return { status: 'pass', ...parsed, output: truncate(output, 500) };
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    const parsed = parseTestOutput(output);
    return { status: 'fail', ...parsed, output: truncate(output, 500) };
  }
}

function runBuild(projectRoot, pkg) {
  const buildCmd = getBuildCommand(projectRoot, pkg);
  if (!buildCmd) return { status: 'no_build_script', output: '' };

  const timeout = getConfigTimeout(projectRoot);
  try {
    const output = execSync(buildCmd, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout,
      env: { ...process.env, CI: 'true' },
    });
    return { status: 'pass', output: truncate(output, 300) };
  } catch (err) {
    const output = (err.stdout || '') + (err.stderr || '');
    return { status: 'fail', output: truncate(output, 500) };
  }
}

/**
 * Quick status check without running anything — looks at artifacts/cache files.
 */
function detectLastStatus(projectRoot) {
  const result = { build: null, test: null };

  // Check for common test result files
  const testResultFiles = [
    'test-results.json', 'test-results.xml',
    'coverage/coverage-summary.json',
    'junit.xml', '.vitest-result.json',
  ];
  for (const f of testResultFiles) {
    const p = path.join(projectRoot, f);
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;
      result.test = {
        status: 'cached',
        file: f,
        age: ageMinutes < 60 ? `${Math.round(ageMinutes)}m ago` : `${Math.round(ageMinutes / 60)}h ago`,
      };
      break;
    }
  }

  // Check for build output dirs
  const buildDirs = ['dist', 'build', '.next', 'out'];
  for (const d of buildDirs) {
    const p = path.join(projectRoot, d);
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;
      result.build = {
        status: 'cached',
        dir: d,
        age: ageMinutes < 60 ? `${Math.round(ageMinutes)}m ago` : `${Math.round(ageMinutes / 60)}h ago`,
      };
      break;
    }
  }

  return result;
}

function getTestCommand(projectRoot, pkg) {
  // Go
  if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
    return 'go test ./... -count=1 -timeout 120s';
  }
  // Python
  if (fs.existsSync(path.join(projectRoot, 'pytest.ini')) ||
      fs.existsSync(path.join(projectRoot, 'setup.cfg')) ||
      fs.existsSync(path.join(projectRoot, 'pyproject.toml'))) {
    return 'python -m pytest --tb=short -q';
  }
  // Rust
  if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
    return 'cargo test';
  }

  if (!pkg) return null;
  const scripts = pkg.scripts || {};
  const pm = detectPM(projectRoot);

  // Check for test scripts in priority order
  const testScripts = ['test', 'test:unit', 'test:ci', 'test:run'];
  for (const script of testScripts) {
    if (scripts[script] && scripts[script] !== 'echo "Error: no test specified" && exit 1') {
      return script === 'test' ? `${pm} test` : `${pm} run ${script}`;
    }
  }

  // Check for test runners directly
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['vitest']) return 'npx vitest run';
  if (deps['jest']) return 'npx jest --ci';
  if (deps['mocha']) return 'npx mocha';

  return null;
}

function getBuildCommand(projectRoot, pkg) {
  if (!pkg) return null;
  const scripts = pkg.scripts || {};
  if (scripts.build) {
    const pm = detectPM(projectRoot);
    return `${pm} run build`;
  }
  if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
    return 'go build ./...';
  }
  return null;
}

function detectPM(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function readPackageJson(projectRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  } catch {
    return null;
  }
}

function parseTestOutput(output) {
  const info = { passed: null, failed: null, total: null };

  // Jest/Vitest: "Tests:  5 passed, 1 failed, 6 total" or "5 passed, 6 total"
  const jestFull = output.match(/(\d+)\s+passed.*?(\d+)\s+failed.*?(\d+)\s+total/i);
  if (jestFull) {
    info.passed = parseInt(jestFull[1]);
    info.failed = parseInt(jestFull[2]);
    info.total = parseInt(jestFull[3]);
    return info;
  }
  const jestPass = output.match(/(\d+)\s+passed.*?(\d+)\s+total/i);
  if (jestPass) {
    info.passed = parseInt(jestPass[1]);
    info.failed = 0;
    info.total = parseInt(jestPass[2]);
    return info;
  }

  // Vitest v2: "✓ 5 tests passed" or "Tests 5 passed | 2 failed"
  const vitestV2 = output.match(/(\d+)\s+passed\s*\|\s*(\d+)\s+failed/i);
  if (vitestV2) {
    info.passed = parseInt(vitestV2[1]);
    info.failed = parseInt(vitestV2[2]);
    info.total = info.passed + info.failed;
    return info;
  }
  const vitestSimple = output.match(/(\d+)\s+tests?\s+passed/i);
  if (vitestSimple) {
    info.passed = parseInt(vitestSimple[1]);
    info.failed = 0;
    info.total = info.passed;
    return info;
  }

  // Pytest: "5 passed", "5 passed, 2 failed", "5 passed, 1 error"
  const pytestMatch = output.match(/(\d+)\s+passed/i);
  if (pytestMatch) {
    info.passed = parseInt(pytestMatch[1]);
    const failMatch = output.match(/(\d+)\s+failed/i);
    const errorMatch = output.match(/(\d+)\s+error/i);
    info.failed = (failMatch ? parseInt(failMatch[1]) : 0) + (errorMatch ? parseInt(errorMatch[1]) : 0);
    info.total = info.passed + info.failed;
    return info;
  }

  // Go: count "ok" and "FAIL" lines
  const goOk = (output.match(/^ok\s/gm) || []).length;
  const goFail = (output.match(/^FAIL\s/gm) || []).length;
  if (goOk + goFail > 0) {
    info.passed = goOk;
    info.failed = goFail;
    info.total = goOk + goFail;
    return info;
  }

  // TAP format: "# pass 5" / "# fail 2"
  const tapPass = output.match(/#\s*pass\s+(\d+)/i);
  const tapFail = output.match(/#\s*fail\s+(\d+)/i);
  if (tapPass) {
    info.passed = parseInt(tapPass[1]);
    info.failed = tapFail ? parseInt(tapFail[1]) : 0;
    info.total = info.passed + info.failed;
    return info;
  }

  // Generic: look for any "N passed" or "N failed" anywhere
  const genericPass = output.match(/(\d+)\s+pass(?:ed|ing)?/i);
  const genericFail = output.match(/(\d+)\s+fail(?:ed|ing|ure)?/i);
  if (genericPass) {
    info.passed = parseInt(genericPass[1]);
    info.failed = genericFail ? parseInt(genericFail[1]) : 0;
    info.total = info.passed + info.failed;
  }

  return info;
}

function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen) + '\n... (truncated)';
}

function getConfigTimeout(projectRoot) {
  try {
    const configPath = path.join(projectRoot, '.mindswap', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return config.test_timeout || 300000; // default 5 min
    }
  } catch {}
  return 300000;
}

module.exports = { runChecks, detectLastStatus, parseTestOutput };
