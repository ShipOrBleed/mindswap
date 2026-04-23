const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { save } = require('./save');
const { generate } = require('./generate');
const { addToHistory, readState } = require('./state');
const { detectAITool } = require('./detect-ai');

const TOOLS = {
  cursor: {
    generateFlag: 'cursor',
    description: 'Cursor IDE',
    openCmd: process.platform === 'darwin' ? 'open -a "Cursor"' : 'cursor',
    openArg: '.',
  },
  claude: {
    generateFlag: 'claude',
    description: 'Claude Code',
    openCmd: null,
    openArg: null,
  },
  copilot: {
    generateFlag: 'copilot',
    description: 'GitHub Copilot (VS Code)',
    openCmd: 'code',
    openArg: '.',
  },
  codex: {
    generateFlag: 'codex',
    description: 'OpenAI Codex CLI',
    openCmd: null,
    openArg: null,
  },
  windsurf: {
    generateFlag: 'windsurf',
    description: 'Windsurf IDE',
    openCmd: process.platform === 'darwin' ? 'open -a "Windsurf"' : 'windsurf',
    openArg: '.',
  },
  gemini: {
    generateFlag: 'gemini',
    description: 'Google Gemini CLI',
    openCmd: null,
    openArg: null,
  },
  cline: {
    generateFlag: 'cline',
    description: 'Cline',
    openCmd: null,
    openArg: null,
  },
  roo: {
    generateFlag: 'roo',
    description: 'Roo Code',
    openCmd: null,
    openArg: null,
  },
  aider: {
    generateFlag: 'aider',
    description: 'Aider',
    openCmd: null,
    openArg: null,
  },
  amp: {
    generateFlag: 'amp',
    description: 'Amp',
    openCmd: null,
    openArg: null,
  },
};

function resolveTool(toolName) {
  if (!toolName) return null;
  const normalized = String(toolName).trim().toLowerCase();
  if (!normalized) return null;

  if (TOOLS[normalized]) {
    return { key: normalized, ...TOOLS[normalized] };
  }

  const matches = Object.entries(TOOLS)
    .filter(([key, tool]) => {
      const description = tool.description.toLowerCase();
      return description === normalized ||
        description.includes(normalized) ||
        normalized.includes(key);
    })
    .map(([key, tool]) => ({ key, ...tool }));

  return matches.length === 1 ? matches[0] : null;
}

function getConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.mindswap', 'config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

function getHookConfig(projectRoot) {
  const config = getConfig(projectRoot);
  return config.ide_hooks || config.session_hooks || {};
}

function getHookCommand(projectRoot, toolKey, event) {
  const hookConfig = getHookConfig(projectRoot);
  const toolHooks = hookConfig.tools && toolKey ? hookConfig.tools[toolKey] : null;
  return toolHooks?.[event] || hookConfig[event] || null;
}

function buildHookEnv(projectRoot, tool, context = {}) {
  return {
    ...process.env,
    MINDSWAP_PROJECT_ROOT: projectRoot,
    MINDSWAP_TOOL: tool?.key || '',
    MINDSWAP_TOOL_DESCRIPTION: tool?.description || '',
    MINDSWAP_SESSION_EVENT: context.event || '',
    MINDSWAP_EVENT: context.event || '',
    MINDSWAP_TRIGGER: context.trigger || '',
    MINDSWAP_MESSAGE: context.message || '',
    MINDSWAP_SOURCE_TOOL: context.sourceTool || '',
    MINDSWAP_TARGET_TOOL: context.targetTool || '',
  };
}

function recordSessionEvent(projectRoot, event, tool, context = {}, deps = {}) {
  const addHistory = deps.addToHistory || addToHistory;
  const entry = {
    timestamp: context.timestamp || new Date().toISOString(),
    type: event,
    ai_tool: tool.description,
    tool: tool.key,
    message: context.message || `${event.replace('_', ' ')}: ${tool.description}`,
    trigger: context.trigger || 'manual',
    source: context.source || 'switch',
    counterpart: context.counterpart || null,
  };
  addHistory(projectRoot, entry);
  return entry;
}

function runSessionHook(projectRoot, event, tool, context = {}, deps = {}) {
  const exec = deps.execSync || execSync;
  const command = getHookCommand(projectRoot, tool.key, event);
  if (!command) {
    return { ran: false, command: null };
  }

  exec(command, {
    cwd: projectRoot,
    stdio: 'pipe',
    timeout: 5000,
    env: buildHookEnv(projectRoot, tool, { ...context, event }),
  });

  return { ran: true, command };
}

function inferActiveTool(projectRoot, opts = {}, deps = {}) {
  const resolver = deps.resolveTool || resolveTool;
  if (opts.from) {
    return resolver(opts.from);
  }

  const stateReader = deps.readState || readState;
  const detector = deps.detectAITool || detectAITool;

  const fromState = resolver(stateReader(projectRoot)?.last_checkpoint?.ai_tool);
  if (fromState) return fromState;

  return resolver(detector(projectRoot));
}

async function switchTool(projectRoot, toolName, opts = {}, deps = {}) {
  const tool = resolveTool(toolName);
  if (!tool) {
    console.log(chalk.red(`\nUnknown tool: "${toolName}"\n`));
    console.log(chalk.dim('  Available tools:'));
    for (const [key, t] of Object.entries(TOOLS)) {
      console.log(`    ${chalk.white(key.padEnd(10))} ${chalk.dim(t.description)}`);
    }
    console.log();
    return;
  }

  console.log(chalk.bold(`\n⚡ Switching to ${tool.description}\n`));

  const saveFn = deps.save || save;
  const generateFn = deps.generate || generate;
  const exec = deps.execSync || execSync;
  const hooksEnabled = opts.hooks !== false;
  const activeTool = hooksEnabled ? inferActiveTool(projectRoot, opts, deps) : null;

  // Step 1: Save full state (auto-detects everything)
  console.log(chalk.dim('  1. ') + 'Saving state...');
  await saveFn(projectRoot, { message: opts.message || `switching to ${tool.description}`, quiet: true });
  console.log(chalk.green('     ✓ ') + 'State saved');

  // Step 1b: End previous session if we can identify it
  if (hooksEnabled && activeTool && activeTool.key !== tool.key) {
    console.log(chalk.dim('  1b. ') + `Ending ${activeTool.description} session...`);
    recordSessionEvent(projectRoot, 'session_end', activeTool, {
      source: 'switch',
      trigger: 'switch',
      counterpart: tool.key,
      message: `session end: ${activeTool.description} → ${tool.description}`,
    }, deps);
    try {
      runSessionHook(projectRoot, 'session_end', activeTool, {
        trigger: 'switch',
        message: opts.message || '',
        sourceTool: activeTool.key,
        targetTool: tool.key,
      }, deps);
      console.log(chalk.green('     ✓ ') + `${activeTool.description} session ended`);
    } catch {
      console.log(chalk.yellow('     ⚠ ') + `Session end hook failed for ${activeTool.description}`);
    }
  }

  // Step 2: Generate context files
  console.log(chalk.dim('  2. ') + `Generating ${tool.description} context...`);
  const genOpts = { handoff: true, [tool.generateFlag]: true, quiet: true };
  await generateFn(projectRoot, genOpts);
  console.log(chalk.green('     ✓ ') + 'Context files updated');

  // Step 3: Try to open the tool
  if (tool.openCmd && !opts.noOpen) {
    console.log(chalk.dim('  3. ') + `Opening ${tool.description}...`);
    try {
      exec(`${tool.openCmd} ${tool.openArg}`, {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 5000,
      });
      console.log(chalk.green('     ✓ ') + `${tool.description} opened`);
    } catch {
      console.log(chalk.yellow('     ⚠ ') + `Could not open ${tool.description} automatically`);
    }
  }

  if (hooksEnabled) {
    const step = tool.openCmd && !opts.noOpen ? '  4. ' : '  3. ';
    console.log(chalk.dim(step) + `Starting ${tool.description} session...`);
    recordSessionEvent(projectRoot, 'session_start', tool, {
      source: 'switch',
      trigger: 'switch',
      counterpart: activeTool?.key || null,
      message: `session start: ${tool.description}`,
    }, deps);
    try {
      runSessionHook(projectRoot, 'session_start', tool, {
        trigger: 'switch',
        message: opts.message || '',
        sourceTool: activeTool?.key || '',
        targetTool: tool.key,
      }, deps);
      console.log(chalk.green('     ✓ ') + `${tool.description} session started`);
    } catch {
      console.log(chalk.yellow('     ⚠ ') + `Session start hook failed for ${tool.description}`);
    }
  }

  // Summary
  console.log(chalk.bold.green(`\n✓ Ready for ${tool.description}\n`));

  if (toolName === 'cursor') {
    console.log(chalk.dim('  Cursor will auto-read:'));
    console.log(chalk.white('    .cursor/rules/mindswap-context.mdc'));
    console.log(chalk.white('    HANDOFF.md'));
  } else if (toolName === 'claude') {
    console.log(chalk.dim('  Claude Code will auto-read:'));
    console.log(chalk.white('    CLAUDE.md'));
    console.log(chalk.white('    HANDOFF.md'));
  } else if (toolName === 'copilot') {
    console.log(chalk.dim('  Copilot will auto-read:'));
    console.log(chalk.white('    .github/copilot-instructions.md'));
  } else if (toolName === 'codex') {
    console.log(chalk.dim('  Codex/agents will auto-read:'));
    console.log(chalk.white('    AGENTS.md'));
    console.log(chalk.white('    HANDOFF.md'));
  }
  console.log();
}

function getAvailableTools() {
  return Object.entries(TOOLS).map(([key, t]) => ({
    key,
    description: t.description,
  }));
}

module.exports = {
  TOOLS,
  switchTool,
  getAvailableTools,
  resolveTool,
  inferActiveTool,
  getHookCommand,
  recordSessionEvent,
  runSessionHook,
};
