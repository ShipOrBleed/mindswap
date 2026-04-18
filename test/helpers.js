const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

/**
 * Creates a temporary project directory with git init.
 * Returns the path. Caller should call cleanup() when done.
 */
function createTempProject(name = 'relay-test') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@relay.dev"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });

  // Create a package.json so detect works
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'test-project',
    version: '1.0.0',
    dependencies: { express: '^4.0.0' },
    devDependencies: { jest: '^29.0.0' },
  }, null, 2));

  // Create package-lock.json for npm detection
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');

  // Initial commit so git commands work
  execSync('git add -A && git commit -m "init"', { cwd: dir, stdio: 'pipe' });

  return dir;
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

module.exports = { createTempProject, cleanup };
