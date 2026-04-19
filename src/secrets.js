const chalk = require('chalk');

/**
 * Secret patterns to scan for before writing context files.
 * Each pattern has: name, regex, severity (high/medium/low).
 */
const SECRET_PATTERNS = [
  // API Keys
  { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g, severity: 'high' },
  { name: 'AWS Secret Key', regex: /(?:aws_secret_access_key|secret_key)\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}/gi, severity: 'high' },
  { name: 'GitHub Token', regex: /gh[pous]_[A-Za-z0-9_]{36,}/g, severity: 'high' },
  { name: 'npm Token', regex: /npm_[A-Za-z0-9]{36,}/g, severity: 'high' },
  { name: 'Slack Token', regex: /xox[baprs]-[A-Za-z0-9-]{10,}/g, severity: 'high' },
  { name: 'Stripe Key', regex: /sk_(?:live|test)_[A-Za-z0-9]{20,}/g, severity: 'high' },
  { name: 'OpenAI Key', regex: /sk-[A-Za-z0-9]{20,}/g, severity: 'high' },
  { name: 'Anthropic Key', regex: /sk-ant-[A-Za-z0-9-]{20,}/g, severity: 'high' },
  { name: 'Google API Key', regex: /AIza[0-9A-Za-z_-]{35}/g, severity: 'high' },
  { name: 'Supabase Key', regex: /(?:supabase|SUPABASE)[\w_]*(?:KEY|key|Key)\s*[=:]\s*["']?eyJ[A-Za-z0-9_-]{50,}/gi, severity: 'high' },
  { name: 'Firebase Key', regex: /(?:firebase|FIREBASE)[\w_]*(?:KEY|key|Key)\s*[=:]\s*["']?[A-Za-z0-9_-]{30,}/gi, severity: 'medium' },
  { name: 'Vercel Token', regex: /(?:vercel_token|VERCEL_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9]{24,}/gi, severity: 'high' },
  { name: 'SendGrid Key', regex: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g, severity: 'high' },
  { name: 'Twilio Key', regex: /SK[0-9a-fA-F]{32}/g, severity: 'high' },
  { name: 'Resend Key', regex: /re_[A-Za-z0-9]{20,}/g, severity: 'high' },

  // Private Keys
  { name: 'Private Key', regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g, severity: 'high' },
  { name: 'PGP Private Key', regex: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g, severity: 'high' },

  // Connection Strings
  { name: 'Database URL', regex: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss):\/\/[^\s"'`]{10,}/gi, severity: 'high' },
  { name: 'Connection String', regex: /(?:DATABASE_URL|DB_URL|MONGO_URI|REDIS_URL)\s*[=:]\s*["']?[^\s"'`]{10,}/gi, severity: 'high' },

  // Passwords
  { name: 'Password', regex: /(?:password|passwd|pwd|secret)\s*[=:]\s*["']?[^\s"'`]{8,}/gi, severity: 'medium' },
  { name: 'Bearer Token', regex: /Bearer\s+[A-Za-z0-9_-]{20,}/g, severity: 'medium' },

  // .env content
  { name: 'JWT Secret', regex: /(?:JWT_SECRET|JWT_KEY|AUTH_SECRET)\s*[=:]\s*["']?[^\s"'`]{8,}/gi, severity: 'high' },
  { name: 'Encryption Key', regex: /(?:ENCRYPTION_KEY|ENCRYPT_KEY|CIPHER_KEY)\s*[=:]\s*["']?[^\s"'`]{8,}/gi, severity: 'high' },

  // IP & Internal URLs
  { name: 'Internal IP', regex: /(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}/g, severity: 'low' },
];

/**
 * Scan content for secrets. Returns array of findings.
 */
function scanForSecrets(content) {
  const findings = [];

  for (const pattern of SECRET_PATTERNS) {
    const matches = content.match(pattern.regex);
    if (matches) {
      for (const match of matches) {
        // Skip very short matches (likely false positives)
        if (match.length < 12) continue;
        // Skip if it looks like a placeholder
        if (/YOUR_|REPLACE_|xxx|example|placeholder|dummy/i.test(match)) continue;

        findings.push({
          type: pattern.name,
          severity: pattern.severity,
          value: redactValue(match),
          raw: match,
        });
      }
    }
  }

  // Deduplicate by value
  const seen = new Set();
  return findings.filter(f => {
    if (seen.has(f.value)) return false;
    seen.add(f.value);
    return true;
  });
}

/**
 * Redact a secret value for display — show first 4 and last 4 chars.
 */
function redactValue(value) {
  if (value.length <= 12) return '***REDACTED***';
  return value.slice(0, 6) + '...' + value.slice(-4);
}

/**
 * Replace all found secrets in content with redacted versions.
 */
function redactSecrets(content) {
  let cleaned = content;
  for (const pattern of SECRET_PATTERNS) {
    cleaned = cleaned.replace(pattern.regex, (match) => {
      if (match.length < 12) return match;
      if (/YOUR_|REPLACE_|xxx|example|placeholder|dummy/i.test(match)) return match;
      return redactValue(match);
    });
  }
  return cleaned;
}

/**
 * Scan and warn about secrets in generated content.
 * Returns { clean: boolean, findings: [], redacted: string }
 */
function scanAndRedact(content, fileName) {
  const findings = scanForSecrets(content);

  if (findings.length === 0) {
    return { clean: true, findings: [], content };
  }

  // Redact the content
  const redacted = redactSecrets(content);

  return {
    clean: false,
    findings,
    content: redacted,
  };
}

/**
 * Print secret scan warnings to console.
 */
function printSecretWarnings(findings, fileName) {
  if (findings.length === 0) return;

  const highCount = findings.filter(f => f.severity === 'high').length;
  const medCount = findings.filter(f => f.severity === 'medium').length;

  console.log(chalk.bold.red(`\n  ⚠  ${findings.length} secret(s) detected in ${fileName}!\n`));

  for (const f of findings.slice(0, 5)) {
    const icon = f.severity === 'high' ? chalk.red('●') : chalk.yellow('●');
    console.log(`  ${icon} ${chalk.white(f.type)}: ${chalk.dim(f.value)}`);
  }
  if (findings.length > 5) {
    console.log(chalk.dim(`  ... and ${findings.length - 5} more`));
  }

  console.log(chalk.yellow('\n  Secrets were auto-redacted in the output file.'));
  console.log(chalk.dim('  Check your .env files and git history for exposed secrets.\n'));
}

module.exports = { scanForSecrets, redactSecrets, scanAndRedact, printSecretWarnings, SECRET_PATTERNS };
