const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { readState, updateState, addToHistory, getDataDir } = require('./state');
const { isGitRepo, getCurrentBranch, getAllChangedFiles, getDiffSummary, getRecentCommits, getLastCommitInfo } = require('./git');
const { detectAITool } = require('./detect-ai');
const { detectLastStatus, runChecks } = require('./build-test');
const { generate } = require('./generate');
const { calculateQualityScore } = require('./narrative');
const { parseNativeSessions } = require('./session-parser');

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
      for (const s of sessions) {
        if (s.fileEdits?.length > 0) {
          console.log(chalk.dim(`  ${s.tool}:   `) + chalk.white(`${s.fileEdits.length} files edited in last session`));
        }
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
  addToHistory(projectRoot, {
    timestamp: now,
    message: message,
    ai_tool: aiTool,
    task: task,
    ...gitInfo,
  });

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
 * Auto-detect dependency changes by comparing current package.json with saved state.
 * Returns array of decision strings like "added redis (ioredis@^5.0.0)"
 */
function autoDetectDepChanges(projectRoot, state) {
  const changes = [];
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return changes;

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch { return changes; }

  const currentDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const currentDepNames = new Set(Object.keys(currentDeps));

  // Compare with what we know from saved state tech_stack
  const knownTech = new Set((state.project?.tech_stack || []).map(t => t.toLowerCase()));

  // Check for notable new deps that weren't in the detected stack
  const notableDeps = {
    // Databases & ORMs
    'redis': 'Redis', 'ioredis': 'Redis (ioredis)', 'bullmq': 'BullMQ (Redis)', 'bull': 'Bull (Redis)',
    'prisma': 'Prisma', '@prisma/client': 'Prisma', 'drizzle-orm': 'Drizzle ORM', 'drizzle-kit': 'Drizzle Kit',
    'mongoose': 'MongoDB (Mongoose)', 'mongodb': 'MongoDB', 'pg': 'PostgreSQL', 'postgres': 'PostgreSQL',
    '@neondatabase/serverless': 'Neon PostgreSQL', 'mysql2': 'MySQL', 'mysql': 'MySQL',
    'better-sqlite3': 'SQLite', 'sql.js': 'SQLite', 'typeorm': 'TypeORM', 'knex': 'Knex',
    'sequelize': 'Sequelize', '@planetscale/database': 'PlanetScale',
    // Payments
    'stripe': 'Stripe', '@stripe/stripe-js': 'Stripe', 'paypal-rest-sdk': 'PayPal', '@paypal/checkout-server-sdk': 'PayPal',
    'razorpay': 'Razorpay', 'lemon-squeezy': 'Lemon Squeezy',
    // Auth
    'next-auth': 'NextAuth', '@auth/core': 'Auth.js', 'passport': 'Passport.js',
    'lucia': 'Lucia Auth', 'lucia-auth': 'Lucia Auth', '@clerk/nextjs': 'Clerk',
    'jsonwebtoken': 'JWT', 'jose': 'JWT (jose)', 'bcrypt': 'bcrypt',
    // BaaS & Cloud
    'firebase': 'Firebase', 'firebase-admin': 'Firebase Admin',
    '@supabase/supabase-js': 'Supabase', 'supabase': 'Supabase',
    'aws-sdk': 'AWS SDK', '@aws-sdk/client-s3': 'AWS S3', '@aws-sdk/client-dynamodb': 'DynamoDB',
    '@google-cloud/storage': 'GCP Storage', '@azure/storage-blob': 'Azure Blob',
    // Realtime
    'socket.io': 'Socket.IO', 'ws': 'WebSockets', 'pusher': 'Pusher', '@pusher/push-notifications-web': 'Pusher',
    // API & GraphQL
    'graphql': 'GraphQL', '@apollo/server': 'Apollo GraphQL', '@apollo/client': 'Apollo Client',
    '@trpc/server': 'tRPC', '@trpc/client': 'tRPC Client',
    // Monitoring
    '@sentry/node': 'Sentry', '@sentry/nextjs': 'Sentry', 'newrelic': 'New Relic',
    'pino': 'Pino Logger', 'winston': 'Winston Logger', 'datadog-metrics': 'Datadog',
    // AI/ML
    'openai': 'OpenAI', '@anthropic-ai/sdk': 'Anthropic Claude', 'langchain': 'LangChain',
    '@huggingface/inference': 'Hugging Face', 'ai': 'Vercel AI SDK', '@ai-sdk/openai': 'Vercel AI SDK',
    // Email
    'nodemailer': 'Nodemailer', 'resend': 'Resend', '@sendgrid/mail': 'SendGrid', 'postmark': 'Postmark',
    // Storage & CDN
    '@uploadthing/react': 'UploadThing', 'cloudinary': 'Cloudinary', 'sharp': 'Sharp (image processing)',
    // Frameworks (notable additions mid-project)
    'next': 'Next.js', 'express': 'Express', 'fastify': 'Fastify', 'hono': 'Hono',
    '@nestjs/core': 'NestJS', 'remix': 'Remix', 'astro': 'Astro',
    // Testing
    'vitest': 'Vitest', 'jest': 'Jest', 'playwright': 'Playwright', '@playwright/test': 'Playwright',
    'cypress': 'Cypress', 'msw': 'MSW (Mock Service Worker)',
    // Infra
    'docker-compose': 'Docker', 'kubernetes-client': 'Kubernetes',
  };

  // Read previously saved deps (if any)
  const savedDepsPath = path.join(projectRoot, '.mindswap', '.deps-snapshot.json');
  let savedDeps = {};
  try {
    if (fs.existsSync(savedDepsPath)) {
      savedDeps = JSON.parse(fs.readFileSync(savedDepsPath, 'utf-8'));
    }
  } catch {}

  const savedDepNames = new Set(Object.keys(savedDeps));

  // Detect additions
  for (const dep of currentDepNames) {
    if (!savedDepNames.has(dep) && notableDeps[dep]) {
      changes.push(`added ${notableDeps[dep]} (${dep}@${currentDeps[dep]})`);
    }
  }

  // Detect removals
  for (const dep of savedDepNames) {
    if (!currentDepNames.has(dep) && notableDeps[dep]) {
      changes.push(`removed ${notableDeps[dep]} (${dep})`);
    }
  }

  // Save current snapshot for next comparison
  try {
    fs.writeFileSync(savedDepsPath, JSON.stringify(currentDeps, null, 2), 'utf-8');
  } catch {}

  return changes;
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
