const fs = require('fs');
const path = require('path');

const SERVER_FILE = 'server.json';

function getServerJsonPath(projectRoot) {
  return path.join(projectRoot, SERVER_FILE);
}

function getRegistryName(packageJson) {
  return packageJson.mcpName || null;
}

function buildRegistryManifest(packageJson, options = {}) {
  const name = getRegistryName(packageJson);
  if (!name) {
    throw new Error('package.json is missing mcpName');
  }

  const version = packageJson.version;
  const repositoryUrl = typeof packageJson.repository === 'object'
    ? packageJson.repository.url
    : packageJson.repository;

  const manifest = {
    $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    name,
    title: options.title || humanizeName(packageJson.name),
    description: options.description || 'Local-first AI context and memory server for cross-tool coding continuity.',
    repository: repositoryUrl ? {
      url: normalizeRepositoryUrl(repositoryUrl),
      source: 'github',
    } : undefined,
    version,
    packages: [{
      registryType: 'npm',
      identifier: packageJson.name,
      version,
      transport: {
        type: 'stdio',
      },
      packageArguments: [{
        type: 'positional',
        value: 'mcp',
      }],
    }],
  };

  if (options.remoteUrl) {
    manifest.remotes = [{
      type: 'streamable-http',
      url: options.remoteUrl,
    }];
  }

  return stripUndefined(manifest);
}

function writeRegistryManifest(projectRoot, packageJson, options = {}) {
  const manifest = buildRegistryManifest(packageJson, options);
  const filePath = getServerJsonPath(projectRoot);
  fs.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  return { filePath, manifest };
}

function readRegistryManifest(projectRoot) {
  const filePath = getServerJsonPath(projectRoot);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function validateRegistryMetadata(packageJson, manifest, options = {}) {
  const issues = [];

  if (!packageJson.mcpName) {
    issues.push('package.json is missing mcpName');
  }
  if (!manifest) {
    issues.push('server.json is missing');
    return issues;
  }

  if (manifest.name !== packageJson.mcpName) {
    issues.push('server.json name does not match package.json mcpName');
  }
  if (manifest.version !== packageJson.version) {
    issues.push('server.json version does not match package.json version');
  }
  const npmPackage = manifest.packages?.find(item => item.registryType === 'npm');
  if (!npmPackage) {
    issues.push('server.json is missing an npm package entry');
  } else {
    if (npmPackage.identifier !== packageJson.name) {
      issues.push('server.json npm identifier does not match package.json name');
    }
    if (npmPackage.version !== packageJson.version) {
      issues.push('server.json npm version does not match package.json version');
    }
  }

  if (options.requireRemote && !manifest.remotes?.length) {
    issues.push('server.json is missing a remote transport entry');
  }

  return issues;
}

function buildRegistryReport(packageJson, manifest, options = {}) {
  const issues = validateRegistryMetadata(packageJson, manifest, options);
  const ready = issues.length === 0;
  return {
    ready,
    issues,
    manifest,
    package: {
      name: packageJson.name,
      version: packageJson.version,
      mcpName: packageJson.mcpName || null,
    },
    checklist: ready ? [
      'package.json mcpName matches server.json',
      'server.json version matches package version',
      'npm package is published publicly',
      'mcp-publisher login github completed',
      'mcp-publisher publish can run',
    ] : [],
  };
}

function humanizeName(name) {
  return String(name || 'mindswap')
    .replace(/^@[^/]+\//, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function normalizeRepositoryUrl(url) {
  return String(url || '').replace(/^git\+/, '');
}

function stripUndefined(obj) {
  if (Array.isArray(obj)) {
    return obj.map(stripUndefined);
  }
  if (!obj || typeof obj !== 'object') return obj;
  return Object.fromEntries(Object.entries(obj)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, stripUndefined(value)]));
}

module.exports = {
  SERVER_FILE,
  getServerJsonPath,
  buildRegistryManifest,
  writeRegistryManifest,
  readRegistryManifest,
  validateRegistryMetadata,
  buildRegistryReport,
};
