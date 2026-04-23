const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { readState, updateState, addToHistory, getDataDir } = require('./state');
const { isGitRepo, getCurrentBranch, getAllChangedFiles, getDiffSummary, getRecentCommits, getLastCommitInfo } = require('./git');
const { detectAITool } = require('./detect-ai');
const { detectLastStatus, runChecks } = require('./build-test');
const { generate } = require('./generate');
const { calculateQualityScore } = require('./narrative');
const { parseNativeSessions, getSessionSummary } = require('./session-parser');
const { annotateHistoryEntry } = require('./team');

/**
 * THE one command. Auto-detects everything, saves full state, generates all context files.
 * User just runs `mindswap save` (or just `mindswap`) and switches tools.
 */
async function save(projectRoot, opts = {}) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    console.log(chalk.yellow('\nmindswap not initialized. Run: npx mindswap init\n'));
    return;
  }

  const now = new Date().toISOString();
  const state = readState(projectRoot);
  const aiTool = detectAITool(projectRoot);

  const quiet = opts.quiet || false;
  if (!quiet) console.log(chalk.bold('\n⚡ Saving project state...\n'));

  // ─── 1. Auto-detect task from git if no task is set ───
  let task = state.current_task;
  if ((!task.description || task.status === 'idle') && isGitRepo(projectRoot)) {
    const autoTask = autoDetectTask(projectRoot);
    if (autoTask) {
      task = { ...task, ...autoTask, status: 'in_progress', started_at: now };
      if (!quiet) console.log(chalk.dim('  Task:      ') + chalk.white(task.description) + chalk.dim(' (auto-detected)'));
    }
  } else if (task.description) {
    if (!quiet) console.log(chalk.dim('  Task:      ') + chalk.white(task.description));
  }

  // ─── 2. Auto-detect dependency changes as decisions ───
  const depChanges = autoDetectDepChanges(projectRoot, state);
  if (depChanges.length > 0) {
    const decisionsPath = path.join(dataDir, 'decisions.log');
    for (const change of depChanges) {
      fs.appendFileSync(decisionsPath, `[${now}] [auto:deps] ${change}\n`);
    }
    if (!quiet) console.log(chalk.dim('  Decisions: ') + chalk.white(`${depChanges.length} auto-logged from dependency changes`));
  }

  // ─── 3. Gather git state ───
  let gitInfo = {};
  if (isGitRepo(projectRoot)) {
    const branch = getCurrentBranch(projectRoot);
    const changedFiles = getAllChangedFiles(projectRoot);
    const commits = getRecentCommits(projectRoot, 5);
    const lastCommit = getLastCommitInfo(projectRoot);

    gitInfo = {
      git_branch: branch,
      files_changed: changedFiles.map(f => `${f.status}: ${f.file}`),
      git_diff_summary: getDiffSummary(projectRoot),
      recent_commits: commits,
      last_commit: lastCommit,
    };

    if (!quiet) {
      console.log(chalk.dim('  Branch:    ') + chalk.white(branch));
      console.log(chalk.dim('  Changed:   ') + chalk.white(`${changedFiles.length} files`));
      if (commits.length > 0) {
        console.log(chalk.dim('  Last commit:') + chalk.white(` ${commits[0].message}`));
      }
    }
  }

  // ─── 4. Build/test status (quick detection, no full run unless --check) ───
  let buildTest = detectLastStatus(projectRoot);
  if (opts.check) {
    buildTest = runChecks(projectRoot, { test: true, build: false });
  }
  if (buildTest.test) {
    const ts = buildTest.test;
    const icon = ts.status === 'pass' ? chalk.green('✓') :
                 ts.status === 'fail' ? chalk.red('✗') :
                 ts.status === 'cached' ? chalk.dim('○') : '';
    let detail = ts.status;
    if (ts.passed != null) detail = `${ts.passed} passed, ${ts.failed || 0} failed`;
    if (ts.age) detail += ` (${ts.age})`;
    if (!quiet) console.log(chalk.dim('  Tests:     ') + icon + ' ' + chalk.white(detail));
  }

  // ─── 5. Parse native AI sessions for richer context ───
  try {
    const sessions = parseNativeSessions(projectRoot);
    if (sessions.length > 0 && !quiet) {
      const sessionSummary = getSessionSummary(sessions);
      for (const line of sessionSummary.split('\n').filter(Boolean).slice(0, 10)) {
        console.log(chalk.dim('  ') + chalk.white(line.trim()));
      }
    }
  } catch (err) {
    try { process.stderr.write(`mindswap: session parse warning: ${err.message}\n`); } catch {}
  }

  // ─── 6. Auto-detect what was worked on from file changes ───
  const workSummary = autoDetectWorkSummary(projectRoot, gitInfo);
  const message = opts.message || workSummary || 'saving state';

  // ─── 6. Update state ───
  const updates = {
    current_task: task,
    last_checkpoint: {
      timestamp: now,
      message: message,
      ai_tool: aiTool,
      ...gitInfo,
    },
    modified_files: gitInfo.files_changed || [],
  };
  if (buildTest.test) updates.test_status = buildTest.test;
  if (buildTest.build) updates.build_status = buildTest.build;

  updateState(projectRoot, updates);

  // ─── 7. Save to history ───
  addToHistory(projectRoot, annotateHistoryEntry(projectRoot, {
    timestamp: now,
    message: message,
    ai_tool: aiTool,
    task: task,
    ...gitInfo,
  }));

  // ─── 8. Generate ALL context files ───
  if (!quiet) console.log(chalk.dim('  Generating context files...'));
  await generate(projectRoot, { all: true, quiet: true });
  if (!quiet) {
    console.log(chalk.green('     ✓ ') + chalk.dim('HANDOFF.md, CLAUDE.md, AGENTS.md, .cursor/rules, copilot-instructions'));

    // Quality score
    const finalState = readState(projectRoot);
    const qualityData = {
      branch: gitInfo.git_branch || null,
      changedFiles: gitInfo.files_changed ? gitInfo.files_changed.map(f => ({ file: f, status: 'changed' })) : [],
      recentCommits: gitInfo.recent_commits || [],
      decisions: [],
      history: [],
    };
    try {
      const dp = path.join(dataDir, 'decisions.log');
      if (fs.existsSync(dp)) {
        qualityData.decisions = fs.readFileSync(dp, 'utf-8').split('\n').filter(l => l.startsWith('['));
      }
    } catch {}
    const quality = calculateQualityScore(finalState, qualityData);
    const gradeColor = quality.grade === 'A' ? chalk.green : quality.grade === 'B' ? chalk.cyan : quality.grade === 'C' ? chalk.yellow : chalk.red;
    console.log(chalk.dim('  Quality:   ') + gradeColor(`${quality.grade} (${quality.score}/100)`));
    if (quality.missing.length > 0 && quality.score < 75) {
      console.log(chalk.dim('  Tip:       ') + chalk.yellow(quality.missing[0]));
    }

    console.log(chalk.bold.green('\n✓ State saved — ready to switch tools\n'));
    console.log(chalk.dim('  Any AI tool will read HANDOFF.md and know exactly where you left off.'));
    console.log(chalk.dim('  Or switch directly: ') + chalk.white('npx mindswap switch cursor'));
    console.log();
  }
}

/**
 * Auto-detect current task from recent git commits and branch name.
 */
function autoDetectTask(projectRoot) {
  // Try branch name first — often describes the feature
  const branch = getCurrentBranch(projectRoot);
  const skipBranches = ['main', 'master', 'develop', 'development', 'staging', 'production', 'release'];
  if (branch && !skipBranches.includes(branch) && !branch.startsWith('HEAD detached')) {
    // Parse branch name: feat/auth-middleware → "auth middleware"
    // Supports: feat/, fix/, add/, task/, ticket/, wip/, bugfix/, hotfix/, improvement/, PROJ-123-desc
    const taskFromBranch = branch
      .replace(/^(feat|feature|fix|add|update|refactor|chore|hotfix|bugfix|task|ticket|wip|improvement|release)\//i, '')
      .replace(/^[A-Z]+-\d+-?/i, '') // Strip JIRA-style prefix: PROJ-123-
      .replace(/[-_]/g, ' ')
      .trim();

    if (taskFromBranch.length > 2) {
      // Get more context from recent commits
      const commits = getRecentCommits(projectRoot, 3);
      const commitMsgs = commits.map(c => c.message).join('; ');
      const description = taskFromBranch + (commitMsgs ? ` — recent: ${commitMsgs}` : '');

      return { description };
    }
  }

  // Fall back to recent commit messages
  const commits = getRecentCommits(projectRoot, 3);
  if (commits.length > 0) {
    // Use most recent non-merge commit
    const meaningful = commits.find(c => !c.message.startsWith('Merge'));
    if (meaningful) {
      return { description: meaningful.message };
    }
  }

  return null;
}

/**
 * Auto-detect dependency changes across supported ecosystems.
 * Returns array of decision strings like "added Redis (ioredis@^5.0.0)".
 */
function autoDetectDepChanges(projectRoot, state) {
  const changes = [];
  const currentDeps = collectDependencySnapshot(projectRoot);
  const currentDepNames = new Set(Object.keys(currentDeps));

  const savedDepsPath = path.join(projectRoot, '.mindswap', '.deps-snapshot.json');
  let savedDeps = {};
  try {
    if (fs.existsSync(savedDepsPath)) {
      savedDeps = JSON.parse(fs.readFileSync(savedDepsPath, 'utf-8'));
    }
  } catch {}

  const savedDepNames = new Set(Object.keys(savedDeps));

  for (const dep of currentDepNames) {
    if (!savedDepNames.has(dep) && NOTABLE_DEPS[dep]) {
      changes.push(`added ${NOTABLE_DEPS[dep]} (${dep}@${currentDeps[dep]})`);
    }
  }

  for (const dep of savedDepNames) {
    if (!currentDepNames.has(dep) && NOTABLE_DEPS[dep]) {
      changes.push(`removed ${NOTABLE_DEPS[dep]} (${dep})`);
    }
  }

  try {
    fs.writeFileSync(savedDepsPath, JSON.stringify(currentDeps, null, 2), 'utf-8');
  } catch {}

  return changes;
}

const NOTABLE_DEPS = {
  // JS/TS
  'redis': 'Redis', 'ioredis': 'Redis (ioredis)', 'bullmq': 'BullMQ (Redis)', 'bull': 'Bull (Redis)',
  'prisma': 'Prisma', '@prisma/client': 'Prisma', 'drizzle-orm': 'Drizzle ORM', 'drizzle-kit': 'Drizzle Kit',
  'mongoose': 'MongoDB (Mongoose)', 'mongodb': 'MongoDB', 'pg': 'PostgreSQL', 'postgres': 'PostgreSQL',
  '@neondatabase/serverless': 'Neon PostgreSQL', 'mysql2': 'MySQL', 'mysql': 'MySQL',
  'better-sqlite3': 'SQLite', 'sql.js': 'SQLite', 'typeorm': 'TypeORM', 'knex': 'Knex',
  'sequelize': 'Sequelize', '@planetscale/database': 'PlanetScale',
  'stripe': 'Stripe', '@stripe/stripe-js': 'Stripe', 'paypal-rest-sdk': 'PayPal', '@paypal/checkout-server-sdk': 'PayPal',
  'razorpay': 'Razorpay', 'lemon-squeezy': 'Lemon Squeezy',
  'next-auth': 'NextAuth', '@auth/core': 'Auth.js', 'passport': 'Passport.js',
  'lucia': 'Lucia Auth', 'lucia-auth': 'Lucia Auth', '@clerk/nextjs': 'Clerk',
  'jsonwebtoken': 'JWT', 'jose': 'JWT (jose)', 'bcrypt': 'bcrypt',
  'firebase': 'Firebase', 'firebase-admin': 'Firebase Admin',
  '@supabase/supabase-js': 'Supabase', 'supabase': 'Supabase',
  'aws-sdk': 'AWS SDK', '@aws-sdk/client-s3': 'AWS S3', '@aws-sdk/client-dynamodb': 'DynamoDB',
  '@google-cloud/storage': 'GCP Storage', '@azure/storage-blob': 'Azure Blob',
  'socket.io': 'Socket.IO', 'ws': 'WebSockets', 'pusher': 'Pusher', '@pusher/push-notifications-web': 'Pusher',
  'graphql': 'GraphQL', '@apollo/server': 'Apollo GraphQL', '@apollo/client': 'Apollo Client',
  '@trpc/server': 'tRPC', '@trpc/client': 'tRPC Client',
  '@sentry/node': 'Sentry', '@sentry/nextjs': 'Sentry', 'newrelic': 'New Relic',
  'pino': 'Pino Logger', 'winston': 'Winston Logger', 'datadog-metrics': 'Datadog',
  'openai': 'OpenAI', '@anthropic-ai/sdk': 'Anthropic Claude', 'langchain': 'LangChain',
  '@huggingface/inference': 'Hugging Face', 'ai': 'Vercel AI SDK', '@ai-sdk/openai': 'Vercel AI SDK',
  'nodemailer': 'Nodemailer', 'resend': 'Resend', '@sendgrid/mail': 'SendGrid', 'postmark': 'Postmark',
  '@uploadthing/react': 'UploadThing', 'cloudinary': 'Cloudinary', 'sharp': 'Sharp (image processing)',
  'next': 'Next.js', 'express': 'Express', 'fastify': 'Fastify', 'hono': 'Hono',
  '@nestjs/core': 'NestJS', 'remix': 'Remix', 'astro': 'Astro',
  'vitest': 'Vitest', 'jest': 'Jest', 'playwright': 'Playwright', '@playwright/test': 'Playwright',
  'cypress': 'Cypress', 'msw': 'MSW (Mock Service Worker)',
  'docker-compose': 'Docker', 'kubernetes-client': 'Kubernetes',
  // Python
  'django': 'Django', 'flask': 'Flask', 'fastapi': 'FastAPI', 'streamlit': 'Streamlit',
  'sqlalchemy': 'SQLAlchemy', 'psycopg2': 'PostgreSQL (psycopg2)', 'psycopg2-binary': 'PostgreSQL (psycopg2-binary)',
  'redis-py': 'Redis (redis-py)', 'redis': 'Redis', 'celery': 'Celery', 'uvicorn': 'Uvicorn',
  'gunicorn': 'Gunicorn', 'pytest': 'Pytest', 'pydantic': 'Pydantic', 'httpx': 'HTTPX',
  // Go
  'github.com/gin-gonic/gin': 'Gin', 'github.com/labstack/echo/v4': 'Echo', 'github.com/gofiber/fiber/v2': 'Fiber',
  'gofr.dev': 'GoFr', 'gorm.io/gorm': 'GORM', 'gorm.io/driver/postgres': 'GORM Postgres',
  'gorm.io/driver/mysql': 'GORM MySQL', 'gorm.io/driver/sqlite': 'GORM SQLite',
  'github.com/redis/go-redis/v9': 'Redis (go-redis)', 'github.com/stripe/stripe-go/v78': 'Stripe',
  'github.com/aws/aws-sdk-go-v2': 'AWS SDK v2',
  // Rust
  'actix-web': 'Actix Web', 'axum': 'Axum', 'rocket': 'Rocket', 'tokio': 'Tokio',
  'sqlx': 'SQLx', 'diesel': 'Diesel', 'serde': 'Serde', 'reqwest': 'Reqwest',
  'redis-rs': 'Redis (redis-rs)', 'redis': 'Redis', 'sea-orm': 'SeaORM',
  // Ruby
  'rails': 'Rails', 'sinatra': 'Sinatra', 'sidekiq': 'Sidekiq', 'pg': 'PostgreSQL',
  'mysql2': 'MySQL', 'redis': 'Redis', 'devise': 'Devise', 'puma': 'Puma',
};

function collectDependencySnapshot(projectRoot) {
  const snapshot = {};
  mergeInto(snapshot, parsePackageJsonDeps(projectRoot));
  mergeInto(snapshot, parseRequirementsDeps(projectRoot));
  mergeInto(snapshot, parsePyprojectDeps(projectRoot));
  mergeInto(snapshot, parseGoModDeps(projectRoot));
  mergeInto(snapshot, parseCargoDeps(projectRoot));
  mergeInto(snapshot, parseGemfileDeps(projectRoot));
  return snapshot;
}

function mergeInto(target, source) {
  for (const [name, version] of Object.entries(source)) {
    target[name] = version;
  }
}

function parsePackageJsonDeps(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return {};
  }
}

function parseRequirementsDeps(projectRoot) {
  const files = ['requirements.txt', 'Pipfile.lock', 'poetry.lock'];
  const deps = {};

  const reqPath = path.join(projectRoot, 'requirements.txt');
  if (fs.existsSync(reqPath)) {
    const content = fs.readFileSync(reqPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
      const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*(?:==|>=|<=|~=|!=|>|<)?\s*([^;\s]+)?/);
      if (match) deps[match[1].toLowerCase()] = match[2] || 'unknown';
    }
  }

  const pipfileLockPath = path.join(projectRoot, 'Pipfile.lock');
  if (fs.existsSync(pipfileLockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(pipfileLockPath, 'utf-8'));
      for (const section of ['default', 'develop']) {
        for (const [name, info] of Object.entries(lock[section] || {})) {
          deps[name.toLowerCase()] = typeof info === 'string' ? info : info.version || 'unknown';
        }
      }
    } catch {}
  }

  return deps;
}

function parsePyprojectDeps(projectRoot) {
  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (!fs.existsSync(pyprojectPath)) return {};
  const deps = {};
  const content = fs.readFileSync(pyprojectPath, 'utf-8');

  const patterns = [
    /dependencies\s*=\s*\[([\s\S]*?)\]/m,
    /dev-dependencies\s*=\s*\[([\s\S]*?)\]/m,
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (!match) continue;
    const entries = match[1].split('\n').map(line => line.trim()).filter(Boolean);
    for (const entry of entries) {
      const depMatch = entry.match(/"?([A-Za-z0-9_.-]+)[^"]*"?/);
      if (depMatch) {
        const name = depMatch[1].toLowerCase();
        const versionMatch = entry.match(/([0-9][A-Za-z0-9.+-]*)/);
        deps[name] = versionMatch ? versionMatch[1] : 'unknown';
      }
    }
  }

  const poetrySectionMatch = content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/m);
  if (poetrySectionMatch) {
    for (const line of poetrySectionMatch[1].split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('python')) continue;
      const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*["']?([^"']+)["']?/);
      if (match) deps[match[1].toLowerCase()] = match[2];
    }
  }

  return deps;
}

function parseGoModDeps(projectRoot) {
  const goModPath = path.join(projectRoot, 'go.mod');
  if (!fs.existsSync(goModPath)) return {};
  const deps = {};
  const content = fs.readFileSync(goModPath, 'utf-8');
  const requireBlockMatch = content.match(/require\s*\(([\s\S]*?)\)/m);
  if (requireBlockMatch) {
    for (const line of requireBlockMatch[1].split('\n')) {
      const trimmed = line.trim();
      const match = trimmed.match(/^([^\s]+)\s+([^\s]+)/);
      if (match) deps[match[1]] = match[2];
    }
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    const match = trimmed.match(/^require\s+([^\s]+)\s+([^\s]+)/);
    if (match) deps[match[1]] = match[2];
  }
  return deps;
}

function parseCargoDeps(projectRoot) {
  const cargoPath = path.join(projectRoot, 'Cargo.toml');
  if (!fs.existsSync(cargoPath)) return {};
  const deps = {};
  const content = fs.readFileSync(cargoPath, 'utf-8');
  const sections = new Set(['dependencies', 'dev-dependencies', 'build-dependencies']);
  let currentSection = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sections.has(sectionMatch[1]) ? sectionMatch[1] : null;
      continue;
    }

    if (!currentSection) continue;

    const depMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!depMatch) continue;
    const name = depMatch[1];
    const versionMatch = depMatch[2].match(/["']([^"']+)["']/);
    deps[name] = versionMatch ? versionMatch[1] : depMatch[2].trim();
  }

  return deps;
}

function parseGemfileDeps(projectRoot) {
  const gemfilePath = path.join(projectRoot, 'Gemfile');
  if (!fs.existsSync(gemfilePath)) return {};
  const deps = {};
  const content = fs.readFileSync(gemfilePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^gem\s+['"]([^'"]+)['"](?:,\s*['"]([^'"]+)['"])?/);
    if (match) deps[match[1]] = match[2] || 'unknown';
  }
  return deps;
}

/**
 * Auto-generate a work summary from file changes and recent commits.
 */
function autoDetectWorkSummary(projectRoot, gitInfo) {
  const parts = [];

  // From recent commits
  if (gitInfo.recent_commits?.length > 0) {
    const latest = gitInfo.recent_commits[0];
    parts.push(latest.message);
  }

  // From changed files — detect what areas are being worked on
  if (gitInfo.files_changed?.length > 0) {
    const areas = new Set();
    for (const f of gitInfo.files_changed) {
      const file = f.split(': ').pop();
      if (file.includes('auth') || file.includes('login')) areas.add('auth');
      if (file.includes('api') || file.includes('route')) areas.add('API');
      if (file.includes('test') || file.includes('spec')) areas.add('tests');
      if (file.includes('component') || file.includes('page')) areas.add('UI');
      if (file.includes('db') || file.includes('migration') || file.includes('schema')) areas.add('database');
      if (file.includes('config') || file.includes('.env')) areas.add('config');
    }
    if (areas.size > 0) {
      parts.push(`working on: ${[...areas].join(', ')}`);
    }
  }

  return parts.join(' — ') || null;
}

module.exports = { save, autoDetectTask, autoDetectDepChanges, autoDetectWorkSummary };
