const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const { readState, updateState, getDataDir } = require('./state');
const { getAllChangedFiles } = require('./git');

async function watch(projectRoot, opts = {}) {
  const relayDir = getDataDir(projectRoot);
  if (!fs.existsSync(relayDir)) {
    console.log(chalk.yellow('\nmindswap not initialized. Run: npx mindswap init\n'));
    return;
  }

  const config = getConfig(projectRoot);
  const debounceMs = parseInt(opts.interval) || 2000;

  console.log(chalk.bold('\n⚡ mindswap watching...\n'));
  console.log(chalk.dim('  Monitoring file changes and updating state.'));
  console.log(chalk.dim(`  Debounce: ${debounceMs}ms`));
  console.log(chalk.dim('  Press Ctrl+C to stop.\n'));

  let debounceTimer = null;

  const watchPatterns = config.watch_patterns || ['src/**', 'lib/**', 'app/**', 'pages/**', 'components/**'];
  const ignorePatterns = config.ignore_patterns || ['node_modules', 'dist', 'build', '.next', '.mindswap/history'];

  const watcher = chokidar.watch(watchPatterns, {
    cwd: projectRoot,
    ignored: [
      ...ignorePatterns.map(p => path.join(projectRoot, p)),
      /(^|[/\\])\../, // dotfiles (except explicitly watched)
      path.join(projectRoot, '.mindswap', '**'),
      path.join(projectRoot, 'node_modules', '**'),
    ],
    ignoreInitial: true,
    persistent: true,
  });

  let updatePending = false;

  function scheduleUpdate() {
    updatePending = true;
    if (debounceTimer) return; // Already scheduled, changes will be picked up
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      if (!updatePending) return;
      updatePending = false;
      try {
        const changed = getAllChangedFiles(projectRoot);
        updateState(projectRoot, {
          modified_files: changed.map(f => `${f.status}: ${f.file}`),
        });

        try {
          const { generate } = require('./generate');
          await generate(projectRoot, { handoff: true, quiet: true });
        } catch {}

        console.log(
          chalk.dim(`  [${new Date().toLocaleTimeString()}] `) +
          chalk.white(`${changed.length} changed files `) +
          chalk.dim('→ HANDOFF.md updated')
        );
      } catch (err) {
        process.stderr.write(`mindswap watch error: ${err.message}\n`);
      }
    }, debounceMs);
  }

  watcher
    .on('change', scheduleUpdate)
    .on('add', scheduleUpdate)
    .on('unlink', scheduleUpdate);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
    console.log(chalk.dim('\n  Stopped watching.\n'));
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

function getConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.mindswap', 'config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

module.exports = { watch };
