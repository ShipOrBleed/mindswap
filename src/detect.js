const fs = require('fs');
const path = require('path');

function detectProject(projectRoot) {
  const info = {
    name: path.basename(projectRoot),
    root: projectRoot,
    tech_stack: [],
    package_manager: null,
    framework: null,
    language: null,
    test_runner: null,
    build_tool: null,
  };

  // Package manager
  if (fs.existsSync(path.join(projectRoot, 'bun.lockb'))) info.package_manager = 'bun';
  else if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) info.package_manager = 'pnpm';
  else if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) info.package_manager = 'yarn';
  else if (fs.existsSync(path.join(projectRoot, 'package-lock.json'))) info.package_manager = 'npm';
  else if (fs.existsSync(path.join(projectRoot, 'Pipfile.lock'))) info.package_manager = 'pipenv';
  else if (fs.existsSync(path.join(projectRoot, 'poetry.lock'))) info.package_manager = 'poetry';
  else if (fs.existsSync(path.join(projectRoot, 'go.sum'))) info.package_manager = 'go modules';
  else if (fs.existsSync(path.join(projectRoot, 'Cargo.lock'))) info.package_manager = 'cargo';

  // Language detection
  const pkgPath = path.join(projectRoot, 'package.json');
  const reqPath = path.join(projectRoot, 'requirements.txt');
  const goModPath = path.join(projectRoot, 'go.mod');
  const cargoPath = path.join(projectRoot, 'Cargo.toml');
  const gemfilePath = path.join(projectRoot, 'Gemfile');
  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');

  if (fs.existsSync(pkgPath)) {
    info.language = 'javascript/typescript';
    info.tech_stack.push('node.js');

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      info.name = pkg.name || info.name;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
      };

      // Frameworks
      if (allDeps['next']) { info.framework = 'Next.js'; info.tech_stack.push('next.js'); }
      else if (allDeps['nuxt']) { info.framework = 'Nuxt'; info.tech_stack.push('nuxt'); }
      else if (allDeps['react']) { info.framework = 'React'; info.tech_stack.push('react'); }
      else if (allDeps['vue']) { info.framework = 'Vue'; info.tech_stack.push('vue'); }
      else if (allDeps['svelte'] || allDeps['@sveltejs/kit']) { info.framework = 'Svelte'; info.tech_stack.push('svelte'); }
      else if (allDeps['express']) { info.framework = 'Express'; info.tech_stack.push('express'); }
      else if (allDeps['fastify']) { info.framework = 'Fastify'; info.tech_stack.push('fastify'); }
      else if (allDeps['hono']) { info.framework = 'Hono'; info.tech_stack.push('hono'); }

      // TypeScript
      if (allDeps['typescript'] || fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) {
        info.language = 'typescript';
        info.tech_stack.push('typescript');
      }

      // Test runners
      if (allDeps['vitest']) info.test_runner = 'vitest';
      else if (allDeps['jest']) info.test_runner = 'jest';
      else if (allDeps['mocha']) info.test_runner = 'mocha';
      else if (allDeps['playwright']) info.test_runner = 'playwright';

      // Build tools
      if (allDeps['vite']) info.build_tool = 'vite';
      else if (allDeps['webpack']) info.build_tool = 'webpack';
      else if (allDeps['esbuild']) info.build_tool = 'esbuild';
      else if (allDeps['turbo']) info.build_tool = 'turborepo';

      // Databases
      if (allDeps['prisma'] || allDeps['@prisma/client']) info.tech_stack.push('prisma');
      if (allDeps['drizzle-orm']) info.tech_stack.push('drizzle');
      if (allDeps['mongoose']) info.tech_stack.push('mongodb');
      if (allDeps['pg'] || allDeps['postgres']) info.tech_stack.push('postgresql');
      if (allDeps['redis'] || allDeps['ioredis']) info.tech_stack.push('redis');

      // CSS
      if (allDeps['tailwindcss']) info.tech_stack.push('tailwind');
      if (allDeps['styled-components']) info.tech_stack.push('styled-components');

      // Infra
      if (allDeps['docker-compose'] || fs.existsSync(path.join(projectRoot, 'Dockerfile'))) info.tech_stack.push('docker');

    } catch {}
  }

  if (fs.existsSync(reqPath) || fs.existsSync(pyprojectPath)) {
    info.language = info.language || 'python';
    info.tech_stack.push('python');
    if (fs.existsSync(path.join(projectRoot, 'manage.py'))) { info.framework = 'Django'; info.tech_stack.push('django'); }
    if (existsInFile(reqPath, 'flask') || existsInFile(pyprojectPath, 'flask')) { info.framework = 'Flask'; info.tech_stack.push('flask'); }
    if (existsInFile(reqPath, 'fastapi') || existsInFile(pyprojectPath, 'fastapi')) { info.framework = 'FastAPI'; info.tech_stack.push('fastapi'); }
  }

  if (fs.existsSync(goModPath)) {
    info.language = info.language || 'go';
    info.tech_stack.push('go');
  }

  if (fs.existsSync(cargoPath)) {
    info.language = info.language || 'rust';
    info.tech_stack.push('rust');
  }

  if (fs.existsSync(gemfilePath)) {
    info.language = info.language || 'ruby';
    info.tech_stack.push('ruby');
    if (fs.existsSync(path.join(projectRoot, 'config', 'routes.rb'))) {
      info.framework = 'Rails';
      info.tech_stack.push('rails');
    }
  }

  // Docker
  if (fs.existsSync(path.join(projectRoot, 'Dockerfile')) || fs.existsSync(path.join(projectRoot, 'docker-compose.yml'))) {
    if (!info.tech_stack.includes('docker')) info.tech_stack.push('docker');
  }

  // Deduplicate
  info.tech_stack = [...new Set(info.tech_stack)];

  return info;
}

function existsInFile(filePath, keyword) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf-8').toLowerCase();
    return content.includes(keyword.toLowerCase());
  } catch {
    return false;
  }
}

module.exports = { detectProject };
