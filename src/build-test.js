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

  try {
    const output = execSync(testCmd, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 120000, // 2 min max
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

  try {
    const output = execSync(buildCmd, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 120000,
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
  if (!pkg) return null;
  const scripts = pkg.scripts || {};
  if (scripts.test && scripts.test !== 'echo "Error: no test specified" && exit 1') {
    const pm = detectPM(projectRoot);
    return `${pm} test`;
  }
  // Check for test runners directly
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['vitest']) return 'npx vitest run';
  if (deps['jest']) return 'npx jest --ci';
  if (deps['mocha']) return 'npx mocha';
  // Python
  if (fs.existsSync(path.join(projectRoot, 'pytest.ini')) ||
      fs.existsSync(path.join(projectRoot, 'pyproject.toml'))) {
    return 'python -m pytest --tb=short -q';
  }
  // Go
  if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
    return 'go test ./...';
  }
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

  // Jest/Vitest: "Tests:  5 passed, 1 failed, 6 total"
  const jestMatch = output.match(/(\d+)\s+passed.*?(\d+)\s+failed.*?(\d+)\s+total/i);
  if (jestMatch) {
    info.passed = parseInt(jestMatch[1]);
    info.failed = parseInt(jestMatch[2]);
    info.total = parseInt(jestMatch[3]);
    return info;
  }

  // Jest/Vitest: "Tests:  5 passed, 5 total" (no failures)
  const jestPassMatch = output.match(/(\d+)\s+passed.*?(\d+)\s+total/i);
  if (jestPassMatch) {
    info.passed = parseInt(jestPassMatch[1]);
    info.failed = 0;
    info.total = parseInt(jestPassMatch[2]);
    return info;
  }

  // Pytest: "5 passed, 2 failed"
  const pytestMatch = output.match(/(\d+)\s+passed(?:.*?(\d+)\s+failed)?/i);
  if (pytestMatch) {
    info.passed = parseInt(pytestMatch[1]);
    info.failed = pytestMatch[2] ? parseInt(pytestMatch[2]) : 0;
    info.total = info.passed + info.failed;
    return info;
  }

  // Go: "ok" or "FAIL"
  if (output.includes('FAIL')) {
    info.failed = 1;
    info.status = 'fail';
  } else if (output.includes('ok')) {
    info.passed = 1;
    info.failed = 0;
  }

  return info;
}

function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen) + '\n... (truncated)';
}

module.exports = { runChecks, detectLastStatus, parseTestOutput };
