const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function createTempProject(name = 'ms-test') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@mindswap.dev"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });

  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: 'test-project',
    version: '1.0.0',
    dependencies: { express: '^4.0.0' },
    devDependencies: { jest: '^29.0.0' },
  }, null, 2));

  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');

  execSync('git add -A && git commit -m "init"', { cwd: dir, stdio: 'pipe' });

  return dir;
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

module.exports = { createTempProject, cleanup };
