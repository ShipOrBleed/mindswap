const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const { readState, updateState, getRelayDir } = require('./state');
const { getAllChangedFiles } = require('./git');

async function watch(projectRoot, opts = {}) {
  const relayDir = getRelayDir(projectRoot);
  if (!fs.existsSync(relayDir)) {
    console.log(chalk.yellow('\nrelay not initialized. Run: npx relay init\n'));
    return;
  }

  console.log(chalk.bold('\n⚡ relay watching...\n'));
  console.log(chalk.dim('  Monitoring file changes and updating state.'));
  console.log(chalk.dim('  Press Ctrl+C to stop.\n'));

  const interval = parseInt(opts.interval) || 2000;
  let lastFileCount = 0;
  let lastUpdate = Date.now();

  // Use polling-based watch (more reliable than chokidar for this use case)
  const tick = async () => {
    try {
      const changed = getAllChangedFiles(projectRoot);
      const currentCount = changed.length;

      // Only update if file count changed (something was modified/added/deleted)
      if (currentCount !== lastFileCount) {
        const now = Date.now();
        // Debounce — don't update more than once per interval
        if (now - lastUpdate > interval) {
          updateState(projectRoot, {
            modified_files: changed.map(f => `${f.status}: ${f.file}`),
          });

          // Auto-regenerate HANDOFF.md
          try {
            const { generate } = require('./generate');
            await generate(projectRoot, { handoff: true, quiet: true });
          } catch {}

          const delta = currentCount - lastFileCount;
          const direction = delta > 0 ? chalk.yellow(`+${delta}`) : chalk.green(`${delta}`);
          console.log(
            chalk.dim(`  [${new Date().toLocaleTimeString()}] `) +
            chalk.white(`${currentCount} changed files `) +
            chalk.dim(`(${direction}) → HANDOFF.md updated`)
          );

          lastFileCount = currentCount;
          lastUpdate = now;
        }
      }
    } catch {}
  };

  // Initial tick
  await tick();

  // Set up interval
  const timer = setInterval(tick, interval);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    clearInterval(timer);
    console.log(chalk.dim('\n  Stopped watching.\n'));
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}

module.exports = { watch };
