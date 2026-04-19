const fs = require('fs');
const path = require('path');

/**
 * Check if a new decision conflicts with existing decisions.
 * Returns array of { existing, reason } objects.
 */
function checkConflicts(projectRoot, newDecision) {
  const dataDir = path.join(projectRoot, '.mindswap');
  const decisionsPath = path.join(dataDir, 'decisions.log');
  if (!fs.existsSync(decisionsPath)) return [];

  const content = fs.readFileSync(decisionsPath, 'utf-8');
  const existing = content.split('\n').filter(l => l.startsWith('['));

  const newNorm = normalize(newDecision);
  const conflicts = [];

  for (const line of existing) {
    // Extract just the message part (after the [tag])
    const msgMatch = line.match(/\]\s*(.+)$/);
    if (!msgMatch) continue;
    const existingMsg = msgMatch[1];
    const existingNorm = normalize(existingMsg);

    const conflict = detectConflict(newNorm, existingNorm);
    if (conflict) {
      conflicts.push({ existing: line, reason: conflict });
    }
  }

  return conflicts;
}

/**
 * Scan all decisions for internal contradictions.
 * Returns array of { a, b, reason } objects.
 */
function findAllConflicts(projectRoot) {
  const dataDir = path.join(projectRoot, '.mindswap');
  const decisionsPath = path.join(dataDir, 'decisions.log');
  if (!fs.existsSync(decisionsPath)) return [];

  const content = fs.readFileSync(decisionsPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.startsWith('['));
  const conflicts = [];
  // Limit to last 100 decisions to avoid O(n²) explosion on large logs
  const recentLines = lines.slice(-100);

  for (let i = 0; i < recentLines.length; i++) {
    for (let j = i + 1; j < recentLines.length; j++) {
      const msgA = extractMessage(recentLines[i]);
      const msgB = extractMessage(recentLines[j]);
      if (!msgA || !msgB) continue;

      const conflict = detectConflict(normalize(msgA), normalize(msgB));
      if (conflict) {
        conflicts.push({ a: recentLines[i], b: recentLines[j], reason: conflict });
        if (conflicts.length >= 20) return conflicts; // Cap at 20 conflicts
      }
    }
  }

  return conflicts;
}

/**
 * Check if package.json dependencies contradict decisions.
 * e.g., decision says "NOT using Redis" but ioredis is in package.json.
 */
function checkDepsVsDecisions(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  const dataDir = path.join(projectRoot, '.mindswap');
  const decisionsPath = path.join(dataDir, 'decisions.log');

  if (!fs.existsSync(pkgPath) || !fs.existsSync(decisionsPath)) return [];

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch { return []; }

  const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const content = fs.readFileSync(decisionsPath, 'utf-8');
  const lines = content.split('\n').filter(l => l.startsWith('['));

  const conflicts = [];
  const depAliases = buildDepAliasMap(allDeps);

  for (const line of lines) {
    const msg = extractMessage(line);
    if (!msg) continue;
    const lower = msg.toLowerCase();

    // "NOT using X" or "don't use X" or "removed X" or "avoid X"
    const negPatterns = [
      /not\s+using\s+(\w[\w.-]*)/i,
      /don'?t\s+use\s+(\w[\w.-]*)/i,
      /removed?\s+(\w[\w.-]*)/i,
      /avoid\s+(\w[\w.-]*)/i,
      /rejected?\s+(\w[\w.-]*)/i,
      /chose\s+\w+\s+over\s+(\w[\w.-]*)/i,
    ];

    for (const pat of negPatterns) {
      const match = lower.match(pat);
      if (match) {
        const rejected = match[1].toLowerCase();
        // Check if this rejected thing is in dependencies
        if (depAliases.has(rejected)) {
          conflicts.push({
            decision: line,
            dep: depAliases.get(rejected),
            reason: `Decision rejects "${rejected}" but "${depAliases.get(rejected)}" is in package.json`,
          });
        }
      }
    }
  }

  return conflicts;
}

// ─── Helpers ───

function normalize(text) {
  // Preserve apostrophes in contractions (don't, we're) then strip other punctuation
  return text.toLowerCase()
    .replace(/n't\b/g, ' not ')  // don't → do not
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMessage(line) {
  const match = line.match(/\]\s*(.+)$/);
  return match ? match[1] : null;
}

function detectConflict(normA, normB) {
  // Pattern 1: "not using X" vs "using X"
  const notUsingA = normA.match(/not\s+using\s+(\w+)/);
  const notUsingB = normB.match(/not\s+using\s+(\w+)/);
  const usingA = normA.match(/(?:^|\s)using\s+(\w+)/);
  const usingB = normB.match(/(?:^|\s)using\s+(\w+)/);

  if (notUsingA && usingB && notUsingA[1] === usingB[1]) {
    return `Contradiction: one says NOT using "${notUsingA[1]}", the other says using it`;
  }
  if (notUsingB && usingA && notUsingB[1] === usingA[1]) {
    return `Contradiction: one says NOT using "${notUsingB[1]}", the other says using it`;
  }

  // Pattern 2: "chose X over Y" vs "chose Y over X"
  const choseA = normA.match(/chose\s+(\w+)\s+over\s+(\w+)/);
  const choseB = normB.match(/chose\s+(\w+)\s+over\s+(\w+)/);
  if (choseA && choseB) {
    if (choseA[1] === choseB[2] && choseA[2] === choseB[1]) {
      return `Contradiction: reversed choice between "${choseA[1]}" and "${choseA[2]}"`;
    }
  }

  // Pattern 3: "chose X over Y" but then "using Y"
  if (choseA && usingB && choseA[2] === usingB[1]) {
    return `Conflict: chose "${choseA[1]}" over "${choseA[2]}", but later using "${choseA[2]}"`;
  }
  if (choseB && usingA && choseB[2] === usingA[1]) {
    return `Conflict: chose "${choseB[1]}" over "${choseB[2]}", but later using "${choseB[2]}"`;
  }

  return null;
}

function buildDepAliasMap(deps) {
  const map = new Map();
  const aliases = {
    redis: ['redis', 'ioredis', 'bull', 'bullmq'],
    prisma: ['prisma', '@prisma/client'],
    drizzle: ['drizzle-orm', 'drizzle-kit'],
    mongoose: ['mongoose'],
    mongodb: ['mongodb', 'mongoose'],
    postgres: ['pg', 'postgres', '@neondatabase/serverless', '@planetscale/database'],
    postgresql: ['pg', 'postgres', '@neondatabase/serverless'],
    mysql: ['mysql', 'mysql2'],
    sqlite: ['better-sqlite3', 'sql.js'],
    supabase: ['@supabase/supabase-js', 'supabase'],
    firebase: ['firebase', 'firebase-admin'],
    dynamodb: ['@aws-sdk/client-dynamodb', 'dynamodb'],
    express: ['express'],
    fastify: ['fastify'],
    hono: ['hono'],
    nestjs: ['@nestjs/core'],
    next: ['next'],
    remix: ['remix', '@remix-run/node'],
    react: ['react'],
    vue: ['vue'],
    svelte: ['svelte', '@sveltejs/kit'],
    angular: ['@angular/core'],
    tailwind: ['tailwindcss'],
    stripe: ['stripe', '@stripe/stripe-js'],
    paypal: ['paypal-rest-sdk', '@paypal/checkout-server-sdk'],
    graphql: ['graphql', '@apollo/server', '@apollo/client'],
    trpc: ['@trpc/server', '@trpc/client'],
    jest: ['jest'],
    vitest: ['vitest'],
    mocha: ['mocha'],
    playwright: ['playwright', '@playwright/test'],
    cypress: ['cypress'],
    sentry: ['@sentry/node', '@sentry/nextjs'],
    openai: ['openai'],
    clerk: ['@clerk/nextjs'],
    passport: ['passport'],
    socket: ['socket.io', 'ws'],
  };

  for (const dep of deps) {
    const lower = dep.toLowerCase();
    map.set(lower, dep);
    for (const [alias, pkgs] of Object.entries(aliases)) {
      if (pkgs.some(p => p.toLowerCase() === lower)) {
        map.set(alias, dep);
      }
    }
  }

  return map;
}

module.exports = { checkConflicts, findAllConflicts, checkDepsVsDecisions };
