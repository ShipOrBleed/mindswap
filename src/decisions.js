const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { getRelayDir } = require('./state');

async function log(projectRoot, message, opts = {}) {
  const relayDir = getRelayDir(projectRoot);
  if (!fs.existsSync(relayDir)) {
    console.log(chalk.yellow('\nrelay not initialized. Run: npx relay init\n'));
    return;
  }

  const decisionsPath = path.join(relayDir, 'decisions.log');
  const timestamp = new Date().toISOString();
  const tag = opts.tag || 'general';

  const entry = `[${timestamp}] [${tag}] ${message}`;

  fs.appendFileSync(decisionsPath, entry + '\n', 'utf-8');

  // Also auto-regenerate HANDOFF.md
  try {
    const { generate } = require('./generate');
    await generate(projectRoot, { handoff: true, quiet: true });
  } catch {}

  console.log(chalk.bold('\n⚡ Decision logged\n'));
  console.log(chalk.dim('  Tag:     ') + chalk.white(tag));
  console.log(chalk.dim('  Message: ') + chalk.white(message));
  console.log(chalk.dim('  File:    ') + chalk.green('.relay/decisions.log'));
  console.log();
}

module.exports = { log };
