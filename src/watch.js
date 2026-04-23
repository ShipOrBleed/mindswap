const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const { readState, updateState, getDataDir } = require('./state');
const { getAllChangedFiles } = require('./git');
const { save } = require('./save');
const { inferActiveTool, resolveTool, recordSessionEvent, runSessionHook } = require('./switch');

async function watch(projectRoot, opts = {}) {
  const relayDir = getDataDir(projectRoot);
  if (!fs.existsSync(relayDir)) {
    console.log(chalk.yellow('\nmindswap not initialized. Run: npx mindswap init\n'));
    return;
  }

  const config = getConfig(projectRoot);
  const debounceMs = parseInt(opts.interval) || 2000;
  const watchPlan = getWatchPlan(opts);
  const session = await startWatchSession(projectRoot, opts);

  console.log(chalk.bold('\n⚡ mindswap watching...\n'));
  console.log(chalk.dim('  Monitoring file changes and updating state.'));
  console.log(chalk.dim(`  Debounce: ${debounceMs}ms`));
  console.log(chalk.dim(`  Mode: ${watchPlan.label}`));
  if (session?.tool) {
    console.log(chalk.dim(`  Session: ${session.tool.description}`));
  }
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
          if (watchPlan.save) {
            await save(projectRoot, { quiet: true, check: opts.check || false });
          } else {
            const { generate } = require('./generate');
            await generate(projectRoot, { ...watchPlan.generateOpts, quiet: true });
          }
        } catch {}

        console.log(
          chalk.dim(`  [${new Date().toLocaleTimeString()}] `) +
          chalk.white(`${changed.length} changed files `) +
          chalk.dim(`→ ${watchPlan.actionLabel}`)
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

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    await watcher.close();
    await stopWatchSession(projectRoot, opts, {
      trigger: signal,
      tool: session?.tool || null,
    });
    console.log(chalk.dim('\n  Stopped watching.\n'));
    process.exit(0);
  }

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    shutdown('SIGINT').catch(err => {
      process.stderr.write(`mindswap watch shutdown error: ${err.message}\n`);
      process.exit(1);
    });
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM').catch(err => {
      process.stderr.write(`mindswap watch shutdown error: ${err.message}\n`);
      process.exit(1);
    });
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

function getWatchPlan(opts = {}) {
  if (opts.save) {
    return {
      save: true,
      label: opts.all ? 'save + full context refresh' : 'save + handoff refresh',
      actionLabel: opts.all ? 'saved state and refreshed all context files' : 'saved state and refreshed HANDOFF.md',
      generateOpts: opts.all ? { all: true } : { handoff: true },
    };
  }

  return {
    save: false,
    label: opts.all ? 'full context refresh' : 'handoff-only refresh',
    actionLabel: opts.all ? 'refreshed all context files' : 'updated HANDOFF.md',
    generateOpts: opts.all ? { all: true } : { handoff: true },
  };
}

async function startWatchSession(projectRoot, opts = {}, deps = {}) {
  if (opts.hooks === false) return { tool: null, saved: false, hookRan: false };

  const saveFn = deps.save || save;
  const resolve = deps.resolveTool || resolveTool;
  const infer = deps.inferActiveTool || inferActiveTool;
  const record = deps.recordSessionEvent || recordSessionEvent;
  const runHook = deps.runSessionHook || runSessionHook;

  const tool = resolve(opts.tool) || infer(projectRoot, opts, deps);
  if (!tool) return { tool: null, saved: false, hookRan: false };

  await saveFn(projectRoot, {
    message: opts.message || `session start: ${tool.description}`,
    quiet: true,
    check: opts.check || false,
  });

  record(projectRoot, 'session_start', tool, {
    source: 'watch',
    trigger: 'watch-start',
    message: `session start: ${tool.description}`,
  }, deps);

  let hookRan = false;
  try {
    const result = runHook(projectRoot, 'session_start', tool, {
      trigger: 'watch-start',
      message: opts.message || '',
      targetTool: tool.key,
    }, deps);
    hookRan = !!result?.ran;
  } catch {}

  return { tool, saved: true, hookRan };
}

async function stopWatchSession(projectRoot, opts = {}, runtime = {}, deps = {}) {
  if (opts.hooks === false) return { tool: null, saved: false, hookRan: false };

  const saveFn = deps.save || save;
  const resolve = deps.resolveTool || resolveTool;
  const infer = deps.inferActiveTool || inferActiveTool;
  const record = deps.recordSessionEvent || recordSessionEvent;
  const runHook = deps.runSessionHook || runSessionHook;

  const tool = runtime.tool || resolve(opts.tool) || infer(projectRoot, opts, deps);
  if (!tool) return { tool: null, saved: false, hookRan: false };

  await saveFn(projectRoot, {
    message: opts.message || `session end: ${tool.description}`,
    quiet: true,
    check: false,
  });

  record(projectRoot, 'session_end', tool, {
    source: 'watch',
    trigger: runtime.trigger || 'watch-stop',
    message: `session end: ${tool.description}`,
  }, deps);

  let hookRan = false;
  try {
    const result = runHook(projectRoot, 'session_end', tool, {
      trigger: runtime.trigger || 'watch-stop',
      message: opts.message || '',
      sourceTool: tool.key,
    }, deps);
    hookRan = !!result?.ran;
  } catch {}

  return { tool, saved: true, hookRan };
}

module.exports = { watch, getWatchPlan, startWatchSession, stopWatchSession };
