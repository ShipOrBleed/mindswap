const fs = require('fs');
const path = require('path');
const { getAllChangedFiles, getDiffContent } = require('./git');

const REJECT_PATTERNS = [
  /not\s+using\s+([a-z0-9@._-]+)/i,
  /don'?t\s+use\s+([a-z0-9@._-]+)/i,
  /avoid\s+([a-z0-9@._-]+)/i,
  /removed?\s+([a-z0-9@._-]+)/i,
  /rejected?\s+([a-z0-9@._-]+)/i,
  /chose\s+[a-z0-9@._-]+\s+over\s+([a-z0-9@._-]+)/i,
  /use\s+[a-z0-9@._-]+\s+instead\s+of\s+([a-z0-9@._-]+)/i,
];

const TERM_ALIASES = {
  session: ['session', 'sessions', 'passport', 'auth-session'],
  sessions: ['session', 'sessions', 'passport', 'auth-session'],
  redis: ['redis', 'ioredis', 'bull', 'bullmq'],
  postgres: ['postgres', 'postgresql', 'pg', '@neondatabase/serverless', '@planetscale/database'],
  postgresql: ['postgres', 'postgresql', 'pg', '@neondatabase/serverless'],
  mysql: ['mysql', 'mysql2'],
  sqlite: ['sqlite', 'better-sqlite3', 'sql.js'],
  stripe: ['stripe', 'billing', 'payment', 'invoice', 'subscription'],
  payment: ['stripe', 'billing', 'payment', 'invoice', 'subscription'],
  payments: ['stripe', 'billing', 'payment', 'invoice', 'subscription'],
  auth: ['auth', 'authentication', 'login', 'jwt', 'token'],
};

function analyzeGuardrails(projectRoot, opts = {}) {
  const changedFiles = opts.changedFiles || getAllChangedFiles(projectRoot);
  const diffContent = opts.diffContent || getDiffContent(projectRoot, 200);
  const decisions = readDecisionLines(projectRoot);
  const surface = buildSurfaceTokens(changedFiles, diffContent);
  const warnings = [];
  const seen = new Set();

  for (const line of decisions) {
    const rejectedTerms = extractRejectedTerms(line);
    for (const term of rejectedTerms) {
      if (!surfaceMatches(term, surface)) continue;
      const key = `${line}::${term}`;
      if (seen.has(key)) continue;
      seen.add(key);
      warnings.push({
        type: 'architectural_drift',
        reason: `Diff appears to touch "${term}" after a decision rejected it`,
        decision: line,
        evidence: sampleEvidence(surface, term),
      });
    }
  }

  return {
    warnings,
    surface,
    decisionLines: decisions,
  };
}

function buildGuardrailSection(guardrails = {}) {
  const warnings = guardrails.warnings || [];
  if (warnings.length === 0) return '';

  const lines = [];
  lines.push('## Guardrails');
  lines.push(`- **Status**: ${warnings.length} drift signal${warnings.length === 1 ? '' : 's'} detected`);
  for (const warning of warnings.slice(0, 5)) {
    lines.push(`- **Warning**: ${warning.reason}`);
    if (warning.decision) lines.push(`  - Decision: ${stripDecisionPrefix(warning.decision)}`);
    if (warning.evidence) lines.push(`  - Evidence: ${warning.evidence}`);
  }
  return lines.join('\n');
}

function extractRejectedTerms(line) {
  const terms = new Set();
  const text = String(line || '');
  for (const pattern of REJECT_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      addTermVariants(terms, match[1]);
    }
  }
  return [...terms];
}

function buildSurfaceTokens(changedFiles, diffContent) {
  const tokens = new Set();
  for (const file of changedFiles || []) {
    addTokenizedPath(tokens, file.file || file);
    addTokenizedText(tokens, file.status || '');
  }
  addTokenizedText(tokens, diffContent || '');
  return tokens;
}

function addTokenizedPath(tokens, value) {
  const base = path.basename(String(value || ''));
  addTokenizedText(tokens, base);
  addTokenizedText(tokens, String(value || ''));
}

function addTokenizedText(tokens, value) {
  for (const token of String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9@]+/)
    .map(token => token.trim())
    .filter(Boolean)) {
    tokens.add(token);
  }
}

function surfaceMatches(term, surfaceTokens) {
  const variants = new Set();
  addTermVariants(variants, term);
  for (const variant of variants) {
    if (surfaceTokens.has(variant)) return true;
  }
  return false;
}

function addTermVariants(set, term) {
  const normalized = String(term || '').toLowerCase().replace(/[^a-z0-9@._-]/g, '');
  if (!normalized) return;
  set.add(normalized);
  if (normalized.endsWith('s')) set.add(normalized.slice(0, -1));
  if (TERM_ALIASES[normalized]) {
    for (const alias of TERM_ALIASES[normalized]) set.add(alias);
  }
}

function sampleEvidence(surfaceTokens, term) {
  const variants = new Set();
  addTermVariants(variants, term);
  for (const token of surfaceTokens) {
    if (variants.has(token)) return token;
  }
  return [...variants][0] || '';
}

function readDecisionLines(projectRoot) {
  const decisionsPath = path.join(projectRoot, '.mindswap', 'decisions.log');
  if (!fs.existsSync(decisionsPath)) return [];
  return fs.readFileSync(decisionsPath, 'utf-8')
    .split('\n')
    .filter(line => line.startsWith('['));
}

function stripDecisionPrefix(line) {
  return String(line || '').replace(/^\[.*?\]\s*\[.*?\]\s*/, '').trim();
}

module.exports = {
  analyzeGuardrails,
  buildGuardrailSection,
  extractRejectedTerms,
  buildSurfaceTokens,
  surfaceMatches,
};
