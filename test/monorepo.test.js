const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { detectMonorepo, getMonorepoSection, detectChangedPackages } = require('../src/monorepo');

let dir;
function setup() { dir = createTempProject('monorepo-test'); }
function teardown() { cleanup(dir); }

exports.test_detects_not_monorepo = () => {
  setup();
  try {
    const result = detectMonorepo(dir);
    assert.strictEqual(result.isMonorepo, false);
    assert.strictEqual(result.packages.length, 0);
  } finally { teardown(); }
};

exports.test_detects_npm_workspaces = () => {
  setup();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
    pkg.workspaces = ['packages/web', 'packages/api'];
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    fs.mkdirSync(path.join(dir, 'packages', 'web'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'packages', 'api'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages', 'web', 'package.json'), '{"name":"@test/web"}');
    fs.writeFileSync(path.join(dir, 'packages', 'api', 'package.json'), '{"name":"@test/api"}');

    const result = detectMonorepo(dir);
    assert.strictEqual(result.isMonorepo, true);
    assert.strictEqual(result.tool, 'workspaces');
    assert.ok(result.packages.length >= 2, `expected >= 2 packages, got ${result.packages.length}`);
  } finally { teardown(); }
};

exports.test_detects_turborepo = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, 'turbo.json'), '{}');
    const result = detectMonorepo(dir);
    assert.strictEqual(result.isMonorepo, true);
    assert.strictEqual(result.tool, 'turborepo');
  } finally { teardown(); }
};

exports.test_detects_nx = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, 'nx.json'), '{}');
    const result = detectMonorepo(dir);
    assert.strictEqual(result.isMonorepo, true);
    assert.strictEqual(result.tool, 'nx');
  } finally { teardown(); }
};

exports.test_detects_lerna = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, 'lerna.json'), '{"packages":["packages/*"]}');
    fs.mkdirSync(path.join(dir, 'packages', 'lib'), { recursive: true });
    const result = detectMonorepo(dir);
    assert.strictEqual(result.isMonorepo, true);
    assert.strictEqual(result.tool, 'lerna');
  } finally { teardown(); }
};

exports.test_getMonorepoSection_empty = () => {
  const result = getMonorepoSection({ isMonorepo: false, packages: [] });
  assert.strictEqual(result, '');
};

exports.test_getMonorepoSection_with_packages = () => {
  const result = getMonorepoSection({
    isMonorepo: true, tool: 'turborepo',
    packages: [{ name: '@test/web', relativePath: 'packages/web' }, { name: '@test/api', relativePath: 'packages/api' }],
  });
  assert.ok(result.includes('turborepo'));
  assert.ok(result.includes('@test/web'));
  assert.ok(result.includes('2 packages'));
};

exports.test_detectChangedPackages = () => {
  const mono = {
    isMonorepo: true,
    packages: [
      { name: '@test/web', relativePath: 'packages/web' },
      { name: '@test/api', relativePath: 'packages/api' },
    ],
  };
  const changed = [{ file: 'packages/web/src/index.ts' }, { file: 'packages/web/README.md' }, { file: 'root.txt' }];
  const result = detectChangedPackages(mono, changed);
  assert.deepStrictEqual(result, ['@test/web']);
};

exports.test_detectChangedPackages_not_monorepo = () => {
  const result = detectChangedPackages({ isMonorepo: false }, [{ file: 'src/index.ts' }]);
  assert.deepStrictEqual(result, []);
};
