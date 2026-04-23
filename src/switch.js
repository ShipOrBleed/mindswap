const chalk = require('chalk');
const { execSync } = require('child_process');
const { save } = require('./save');
const { generate } = require('./generate');

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

async function switchTool(projectRoot, toolName, opts = {}) {
  const tool = TOOLS[toolName?.toLowerCase()];
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

  // Step 1: Save full state (auto-detects everything)
  console.log(chalk.dim('  1. ') + 'Saving state...');
  await save(projectRoot, { message: opts.message || `switching to ${tool.description}`, quiet: true });
  console.log(chalk.green('     ✓ ') + 'State saved');

  // Step 2: Generate context files
  console.log(chalk.dim('  2. ') + `Generating ${tool.description} context...`);
  const genOpts = { handoff: true, [tool.generateFlag]: true, quiet: true };
  await generate(projectRoot, genOpts);
  console.log(chalk.green('     ✓ ') + 'Context files updated');

  // Step 3: Try to open the tool
  if (tool.openCmd && !opts.noOpen) {
    console.log(chalk.dim('  3. ') + `Opening ${tool.description}...`);
    try {
      execSync(`${tool.openCmd} ${tool.openArg}`, {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 5000,
      });
      console.log(chalk.green('     ✓ ') + `${tool.description} opened`);
    } catch {
      console.log(chalk.yellow('     ⚠ ') + `Could not open ${tool.description} automatically`);
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
    console.log(chalk.white('    CODEX.md'));
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

module.exports = { switchTool, getAvailableTools };
