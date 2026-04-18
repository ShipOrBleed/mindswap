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
    monorepo: null,
  };

  // Package manager
  if (fs.existsSync(path.join(projectRoot, 'bun.lockb'))) info.package_manager = 'bun';
  else if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) info.package_manager = 'pnpm';
  else if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) info.package_manager = 'yarn';
  else if (fs.existsSync(path.join(projectRoot, 'package-lock.json'))) info.package_manager = 'npm';
  else if (fs.existsSync(path.join(projectRoot, 'Pipfile.lock'))) info.package_manager = 'pipenv';
  else if (fs.existsSync(path.join(projectRoot, 'poetry.lock'))) info.package_manager = 'poetry';
  else if (fs.existsSync(path.join(projectRoot, 'uv.lock'))) info.package_manager = 'uv';
  else if (fs.existsSync(path.join(projectRoot, 'go.sum'))) info.package_manager = 'go modules';
  else if (fs.existsSync(path.join(projectRoot, 'Cargo.lock'))) info.package_manager = 'cargo';

  // ─── JS/TS projects ───
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    info.language = 'javascript';
    info.tech_stack.push('node.js');

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      info.name = pkg.name || info.name;

      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      // TypeScript (check early — affects language field)
      if (allDeps['typescript'] || fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) {
        info.language = 'typescript';
        info.tech_stack.push('typescript');
      }

      // Frameworks (order matters — most specific first)
      if (allDeps['next']) { info.framework = 'Next.js'; info.tech_stack.push('next.js'); }
      else if (allDeps['remix'] || allDeps['@remix-run/node']) { info.framework = 'Remix'; info.tech_stack.push('remix'); }
      else if (allDeps['astro']) { info.framework = 'Astro'; info.tech_stack.push('astro'); }
      else if (allDeps['nuxt']) { info.framework = 'Nuxt'; info.tech_stack.push('nuxt'); }
      else if (allDeps['gatsby']) { info.framework = 'Gatsby'; info.tech_stack.push('gatsby'); }
      else if (allDeps['solid-js']) { info.framework = 'SolidJS'; info.tech_stack.push('solid'); }
      else if (allDeps['@angular/core']) { info.framework = 'Angular'; info.tech_stack.push('angular'); }
      else if (allDeps['svelte'] || allDeps['@sveltejs/kit']) { info.framework = 'Svelte'; info.tech_stack.push('svelte'); }
      else if (allDeps['react']) { info.framework = 'React'; info.tech_stack.push('react'); }
      else if (allDeps['vue']) { info.framework = 'Vue'; info.tech_stack.push('vue'); }
      else if (allDeps['hono']) { info.framework = 'Hono'; info.tech_stack.push('hono'); }
      else if (allDeps['fastify']) { info.framework = 'Fastify'; info.tech_stack.push('fastify'); }
      else if (allDeps['express']) { info.framework = 'Express'; info.tech_stack.push('express'); }
      else if (allDeps['koa']) { info.framework = 'Koa'; info.tech_stack.push('koa'); }
      else if (allDeps['@nestjs/core']) { info.framework = 'NestJS'; info.tech_stack.push('nestjs'); }

      // Test runners
      if (allDeps['vitest']) info.test_runner = 'vitest';
      else if (allDeps['jest']) info.test_runner = 'jest';
      else if (allDeps['mocha']) info.test_runner = 'mocha';
      else if (allDeps['ava']) info.test_runner = 'ava';
      // E2E runners
      if (allDeps['playwright'] || allDeps['@playwright/test']) info.tech_stack.push('playwright');
      if (allDeps['cypress']) info.tech_stack.push('cypress');

      // Build tools
      if (allDeps['vite']) info.build_tool = 'vite';
      else if (allDeps['esbuild']) info.build_tool = 'esbuild';
      else if (allDeps['swc'] || allDeps['@swc/core']) info.build_tool = 'swc';
      else if (allDeps['rollup']) info.build_tool = 'rollup';
      else if (allDeps['parcel']) info.build_tool = 'parcel';
      else if (allDeps['webpack']) info.build_tool = 'webpack';
      else if (allDeps['turbo']) info.build_tool = 'turborepo';
      else if (allDeps['tsup']) info.build_tool = 'tsup';

      // Databases & ORMs
      if (allDeps['prisma'] || allDeps['@prisma/client']) info.tech_stack.push('prisma');
      if (allDeps['drizzle-orm']) info.tech_stack.push('drizzle');
      if (allDeps['mongoose'] || allDeps['mongodb']) info.tech_stack.push('mongodb');
      if (allDeps['pg'] || allDeps['postgres'] || allDeps['@neondatabase/serverless']) info.tech_stack.push('postgresql');
      if (allDeps['mysql2'] || allDeps['mysql']) info.tech_stack.push('mysql');
      if (allDeps['better-sqlite3'] || allDeps['sql.js']) info.tech_stack.push('sqlite');
      if (allDeps['redis'] || allDeps['ioredis']) info.tech_stack.push('redis');
      if (allDeps['@supabase/supabase-js']) info.tech_stack.push('supabase');
      if (allDeps['firebase'] || allDeps['firebase-admin']) info.tech_stack.push('firebase');
      if (allDeps['@aws-sdk/client-dynamodb'] || allDeps['dynamodb']) info.tech_stack.push('dynamodb');
      if (allDeps['typeorm']) info.tech_stack.push('typeorm');
      if (allDeps['knex']) info.tech_stack.push('knex');
      if (allDeps['sequelize']) info.tech_stack.push('sequelize');

      // Auth
      if (allDeps['next-auth'] || allDeps['@auth/core']) info.tech_stack.push('auth.js');
      if (allDeps['passport']) info.tech_stack.push('passport');
      if (allDeps['lucia'] || allDeps['lucia-auth']) info.tech_stack.push('lucia');

      // API
      if (allDeps['@trpc/server']) info.tech_stack.push('trpc');
      if (allDeps['graphql'] || allDeps['@apollo/server']) info.tech_stack.push('graphql');
      if (allDeps['stripe']) info.tech_stack.push('stripe');

      // CSS
      if (allDeps['tailwindcss']) info.tech_stack.push('tailwind');
      if (allDeps['styled-components']) info.tech_stack.push('styled-components');
      if (allDeps['@emotion/react']) info.tech_stack.push('emotion');
      if (allDeps['sass'] || allDeps['node-sass']) info.tech_stack.push('sass');

      // Monorepo tools
      if (allDeps['turbo'] || fs.existsSync(path.join(projectRoot, 'turbo.json'))) {
        info.monorepo = 'turborepo';
        info.tech_stack.push('turborepo');
      }
      if (allDeps['lerna'] || fs.existsSync(path.join(projectRoot, 'lerna.json'))) {
        info.monorepo = 'lerna';
        info.tech_stack.push('lerna');
      }
      if (fs.existsSync(path.join(projectRoot, 'nx.json'))) {
        info.monorepo = 'nx';
        info.tech_stack.push('nx');
      }
      if (pkg.workspaces) {
        info.monorepo = info.monorepo || 'workspaces';
        if (!info.tech_stack.includes('monorepo')) info.tech_stack.push('monorepo');
      }

      // Cloud/Infra from deps
      if (allDeps['aws-sdk'] || allDeps['@aws-sdk/client-s3']) info.tech_stack.push('aws');
      if (allDeps['@google-cloud/storage']) info.tech_stack.push('gcp');
      if (allDeps['@azure/storage-blob']) info.tech_stack.push('azure');
      if (allDeps['@sentry/node'] || allDeps['@sentry/nextjs']) info.tech_stack.push('sentry');

    } catch {}
  }

  // ─── Python projects ───
  const reqPath = path.join(projectRoot, 'requirements.txt');
  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (fs.existsSync(reqPath) || fs.existsSync(pyprojectPath)) {
    info.language = info.language || 'python';
    info.tech_stack.push('python');

    if (fs.existsSync(path.join(projectRoot, 'manage.py'))) { info.framework = 'Django'; info.tech_stack.push('django'); }
    else if (existsInFile(reqPath, 'flask') || existsInFile(pyprojectPath, 'flask')) { info.framework = 'Flask'; info.tech_stack.push('flask'); }
    else if (existsInFile(reqPath, 'fastapi') || existsInFile(pyprojectPath, 'fastapi')) { info.framework = 'FastAPI'; info.tech_stack.push('fastapi'); }
    else if (existsInFile(reqPath, 'streamlit') || existsInFile(pyprojectPath, 'streamlit')) { info.framework = 'Streamlit'; info.tech_stack.push('streamlit'); }

    if (existsInFile(reqPath, 'pytest') || existsInFile(pyprojectPath, 'pytest')) info.test_runner = 'pytest';
    if (existsInFile(reqPath, 'sqlalchemy') || existsInFile(pyprojectPath, 'sqlalchemy')) info.tech_stack.push('sqlalchemy');
    if (existsInFile(reqPath, 'celery') || existsInFile(pyprojectPath, 'celery')) info.tech_stack.push('celery');
  }

  // ─── Go projects ───
  if (fs.existsSync(path.join(projectRoot, 'go.mod'))) {
    info.language = info.language || 'go';
    info.tech_stack.push('go');
    // Detect Go frameworks from go.mod
    if (existsInFile(path.join(projectRoot, 'go.mod'), 'gin-gonic')) info.framework = 'Gin';
    else if (existsInFile(path.join(projectRoot, 'go.mod'), 'labstack/echo')) info.framework = 'Echo';
    else if (existsInFile(path.join(projectRoot, 'go.mod'), 'gofiber/fiber')) info.framework = 'Fiber';
    else if (existsInFile(path.join(projectRoot, 'go.mod'), 'gofr.dev')) info.framework = 'GoFr';
  }

  // ─── Rust projects ───
  if (fs.existsSync(path.join(projectRoot, 'Cargo.toml'))) {
    info.language = info.language || 'rust';
    info.tech_stack.push('rust');
    if (existsInFile(path.join(projectRoot, 'Cargo.toml'), 'actix-web')) info.framework = 'Actix';
    else if (existsInFile(path.join(projectRoot, 'Cargo.toml'), 'axum')) info.framework = 'Axum';
    else if (existsInFile(path.join(projectRoot, 'Cargo.toml'), 'rocket')) info.framework = 'Rocket';
  }

  // ─── Ruby projects ───
  if (fs.existsSync(path.join(projectRoot, 'Gemfile'))) {
    info.language = info.language || 'ruby';
    info.tech_stack.push('ruby');
    if (fs.existsSync(path.join(projectRoot, 'config', 'routes.rb'))) {
      info.framework = 'Rails';
      info.tech_stack.push('rails');
    } else if (existsInFile(path.join(projectRoot, 'Gemfile'), 'sinatra')) {
      info.framework = 'Sinatra';
      info.tech_stack.push('sinatra');
    }
  }

  // ─── Java/Kotlin ───
  if (fs.existsSync(path.join(projectRoot, 'pom.xml'))) {
    info.language = info.language || 'java';
    info.tech_stack.push('java');
    info.package_manager = info.package_manager || 'maven';
    if (existsInFile(path.join(projectRoot, 'pom.xml'), 'spring-boot')) { info.framework = 'Spring Boot'; info.tech_stack.push('spring'); }
  } else if (fs.existsSync(path.join(projectRoot, 'build.gradle')) || fs.existsSync(path.join(projectRoot, 'build.gradle.kts'))) {
    info.language = info.language || 'java';
    info.tech_stack.push('java');
    info.package_manager = info.package_manager || 'gradle';
  }

  // ─── Docker ───
  if (fs.existsSync(path.join(projectRoot, 'Dockerfile')) ||
      fs.existsSync(path.join(projectRoot, 'docker-compose.yml')) ||
      fs.existsSync(path.join(projectRoot, 'docker-compose.yaml')) ||
      fs.existsSync(path.join(projectRoot, 'compose.yml')) ||
      fs.existsSync(path.join(projectRoot, 'compose.yaml'))) {
    if (!info.tech_stack.includes('docker')) info.tech_stack.push('docker');
  }

  // ─── CI/CD ───
  if (fs.existsSync(path.join(projectRoot, '.github', 'workflows'))) info.tech_stack.push('github-actions');
  if (fs.existsSync(path.join(projectRoot, '.gitlab-ci.yml'))) info.tech_stack.push('gitlab-ci');
  if (fs.existsSync(path.join(projectRoot, '.circleci'))) info.tech_stack.push('circleci');

  // ─── Kubernetes ───
  if (fs.existsSync(path.join(projectRoot, 'k8s')) || fs.existsSync(path.join(projectRoot, 'kubernetes')) ||
      fs.existsSync(path.join(projectRoot, 'helm'))) {
    info.tech_stack.push('kubernetes');
  }

  // ─── Terraform ───
  if (fs.existsSync(path.join(projectRoot, 'main.tf')) || fs.existsSync(path.join(projectRoot, 'terraform'))) {
    info.tech_stack.push('terraform');
  }

  // Deduplicate
  info.tech_stack = [...new Set(info.tech_stack)];

  return info;
}

function existsInFile(filePath, keyword) {
  try {
    if (!fs.existsSync(filePath)) return false;
    // Read max 1MB to avoid loading huge files
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(1024 * 1024);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return buf.slice(0, bytesRead).toString('utf-8').toLowerCase().includes(keyword.toLowerCase());
  } catch {
    return false;
  }
}

module.exports = { detectProject };
