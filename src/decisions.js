const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { getDataDir } = require('./state');
const { checkConflicts } = require('./conflicts');

async function log(projectRoot, message, opts = {}) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    console.log(chalk.yellow('\nmindswap not initialized. Run: npx mindswap init\n'));
    return;
  }

  // Check for conflicts with existing decisions
  const conflicts = checkConflicts(projectRoot, message);

  const decisionsPath = path.join(dataDir, 'decisions.log');
  const timestamp = new Date().toISOString();
  const tag = opts.tag || 'general';

  const entry = `[${timestamp}] [${tag}] ${message}`;

  fs.appendFileSync(decisionsPath, entry + '\n', 'utf-8');

  // Auto-regenerate HANDOFF.md
  try {
    const { generate } = require('./generate');
    await generate(projectRoot, { handoff: true, quiet: true });
  } catch {}

  console.log(chalk.bold('\n⚡ Decision logged\n'));
  console.log(chalk.dim('  Tag:     ') + chalk.white(tag));
  console.log(chalk.dim('  Message: ') + chalk.white(message));
  console.log(chalk.dim('  File:    ') + chalk.green('.mindswap/decisions.log'));

  // Warn about conflicts
  if (conflicts.length > 0) {
    console.log(chalk.bold.yellow('\n  ⚠  Potential conflicts:'));
    for (const c of conflicts) {
      console.log(chalk.yellow(`    • ${c.reason}`));
      console.log(chalk.dim(`      Existing: ${c.existing}`));
    }
    console.log(chalk.dim('\n  The decision was still logged. Review and resolve if needed.'));
  }

  console.log();
}

module.exports = { log };
