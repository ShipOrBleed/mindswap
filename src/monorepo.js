const fs = require('fs');
const path = require('path');

/**
 * Detect if the project is a monorepo and return workspace info.
 */
function detectMonorepo(projectRoot) {
  const result = {
    isMonorepo: false,
    tool: null,
    packages: [],
  };

  // Turborepo
  if (fs.existsSync(path.join(projectRoot, 'turbo.json'))) {
    result.isMonorepo = true;
    result.tool = 'turborepo';
  }

  // Nx
  if (fs.existsSync(path.join(projectRoot, 'nx.json'))) {
    result.isMonorepo = true;
    result.tool = 'nx';
    try {
      const nx = JSON.parse(fs.readFileSync(path.join(projectRoot, 'nx.json'), 'utf-8'));
      // Nx projects can be defined in nx.json or in individual project.json files
    } catch {}
  }

  // Lerna
  if (fs.existsSync(path.join(projectRoot, 'lerna.json'))) {
    result.isMonorepo = true;
    result.tool = 'lerna';
    try {
      const lerna = JSON.parse(fs.readFileSync(path.join(projectRoot, 'lerna.json'), 'utf-8'));
      if (lerna.packages) {
        result.packages = resolveGlobDirs(projectRoot, lerna.packages);
      }
    } catch {}
  }

  // npm/yarn/pnpm workspaces
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.workspaces) {
        result.isMonorepo = true;
        result.tool = result.tool || 'workspaces';
        const patterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces.packages || []);
        result.packages = resolveGlobDirs(projectRoot, patterns);
      }
    } catch {}
  }

  // pnpm-workspace.yaml
  const pnpmWs = path.join(projectRoot, 'pnpm-workspace.yaml');
  if (fs.existsSync(pnpmWs)) {
    result.isMonorepo = true;
    result.tool = result.tool || 'pnpm';
    try {
      const content = fs.readFileSync(pnpmWs, 'utf-8');
      const packageLines = content.match(/^\s*-\s*['"]?(.+?)['"]?\s*$/gm);
      if (packageLines) {
        const patterns = packageLines.map(l => l.replace(/^\s*-\s*['"]?/, '').replace(/['"]?\s*$/, ''));
        result.packages = resolveGlobDirs(projectRoot, patterns);
      }
    } catch {}
  }

  // Enrich package info
  result.packages = result.packages.map(pkgDir => {
    const info = { name: path.basename(pkgDir), path: pkgDir, relativePath: path.relative(projectRoot, pkgDir) };
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        info.name = pkg.name || info.name;
        info.version = pkg.version;
        info.private = pkg.private;
      } catch {}
    }
    // Check for Go modules
    if (fs.existsSync(path.join(pkgDir, 'go.mod'))) {
      info.language = 'go';
    }
    return info;
  });

  return result;
}

/**
 * Resolve glob patterns like "packages/*" to actual directories.
 */
function resolveGlobDirs(root, patterns) {
  const dirs = [];
  for (const pattern of patterns) {
    const cleanPattern = pattern.replace(/\/\*\*?$/, '');
    if (cleanPattern.includes('*')) {
      // Simple glob — expand one level
      const parentDir = path.join(root, cleanPattern.replace(/\/?\*.*$/, ''));
      if (fs.existsSync(parentDir)) {
        try {
          const entries = fs.readdirSync(parentDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
              dirs.push(path.join(parentDir, entry.name));
            }
          }
        } catch {}
      }
    } else {
      const dirPath = path.join(root, cleanPattern);
      if (fs.existsSync(dirPath)) {
        dirs.push(dirPath);
      }
    }
  }
  return dirs;
}

/**
 * Get monorepo-aware project description for HANDOFF.md.
 */
function getMonorepoSection(monorepoInfo) {
  if (!monorepoInfo.isMonorepo) return '';

  const lines = [];
  lines.push(`\n## Monorepo (${monorepoInfo.tool})`);
  lines.push(`${monorepoInfo.packages.length} packages:\n`);

  for (const pkg of monorepoInfo.packages.slice(0, 20)) {
    const langTag = pkg.language ? ` [${pkg.language}]` : '';
    const versionTag = pkg.version ? ` v${pkg.version}` : '';
    lines.push(`- \`${pkg.relativePath}\` — ${pkg.name}${versionTag}${langTag}`);
  }

  if (monorepoInfo.packages.length > 20) {
    lines.push(`- ... and ${monorepoInfo.packages.length - 20} more packages`);
  }

  return lines.join('\n');
}

/**
 * Detect which package in a monorepo has changes based on git diff.
 */
function detectChangedPackages(monorepoInfo, changedFiles) {
  if (!monorepoInfo.isMonorepo) return [];

  const changedPackages = new Set();
  for (const f of changedFiles) {
    const filePath = f.file || f;
    for (const pkg of monorepoInfo.packages) {
      if (filePath.startsWith(pkg.relativePath + '/') || filePath.startsWith(pkg.relativePath + '\\')) {
        changedPackages.add(pkg.name);
      }
    }
  }
  return [...changedPackages];
}

module.exports = { detectMonorepo, getMonorepoSection, detectChangedPackages };
