const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { readState, getRelayDir, getHistory } = require('./state');
const { isGitRepo, getCurrentBranch, getAllChangedFiles, getDiffSummary, getDiffContent, getRecentCommits } = require('./git');

const RELAY_SECTION_START = '<!-- relay-dev:start -->';
const RELAY_SECTION_END = '<!-- relay-dev:end -->';

async function generate(projectRoot, opts = {}) {
  const state = readState(projectRoot);
  const relayDir = getRelayDir(projectRoot);

  // If no specific flag, default to handoff
  const generateAll = opts.all;
  const generateHandoff = opts.handoff || (!opts.claude && !opts.cursor && !opts.copilot && !opts.agents);

  // Gather live data
  const liveData = gatherLiveData(projectRoot);

  // Generate HANDOFF.md (always, it's the core — this one we fully own)
  if (generateHandoff || generateAll) {
    const handoff = buildHandoffMd(state, liveData);
    fs.writeFileSync(path.join(relayDir, 'HANDOFF.md'), handoff, 'utf-8');
    // Also copy to project root for easy AI access
    fs.writeFileSync(path.join(projectRoot, 'HANDOFF.md'), handoff, 'utf-8');
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + 'HANDOFF.md');
  }

  // AGENTS.md — safe merge
  if (opts.agents || generateAll) {
    const agents = buildAgentsMd(state, liveData);
    safeWriteContextFile(path.join(projectRoot, 'AGENTS.md'), agents, 'AGENTS.md');
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + 'AGENTS.md');
  }

  // CLAUDE.md — safe merge (never overwrite user content)
  if (opts.claude || generateAll) {
    const claude = buildClaudeMd(state, liveData);
    safeWriteContextFile(path.join(projectRoot, 'CLAUDE.md'), claude, 'CLAUDE.md');
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + 'CLAUDE.md');
  }

  // .cursor/rules
  if (opts.cursor || generateAll) {
    const cursorRulesDir = path.join(projectRoot, '.cursor', 'rules');
    if (!fs.existsSync(cursorRulesDir)) fs.mkdirSync(cursorRulesDir, { recursive: true });
    const cursorRules = buildCursorRules(state, liveData);
    // Cursor rules file is fully owned by relay — it's in its own file
    fs.writeFileSync(path.join(cursorRulesDir, 'relay-context.mdc'), cursorRules, 'utf-8');
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + '.cursor/rules/relay-context.mdc');
  }

  // .github/copilot-instructions.md — safe merge
  if (opts.copilot || generateAll) {
    const ghDir = path.join(projectRoot, '.github');
    if (!fs.existsSync(ghDir)) fs.mkdirSync(ghDir, { recursive: true });
    const copilot = buildCopilotMd(state, liveData);
    safeWriteContextFile(path.join(ghDir, 'copilot-instructions.md'), copilot, 'copilot-instructions.md');
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + '.github/copilot-instructions.md');
  }

  if (!opts.quiet) {
    console.log(chalk.bold.green('\n✓ Context files generated\n'));
  }
}

/**
 * Safely writes relay content to a context file without overwriting user content.
 * - If the file doesn't exist: writes the full content wrapped in relay markers.
 * - If the file exists and has relay markers: replaces only the relay section.
 * - If the file exists without relay markers: appends the relay section at the end.
 */
function safeWriteContextFile(filePath, relayContent, fileName) {
  const wrapped = `${RELAY_SECTION_START}\n${relayContent}\n${RELAY_SECTION_END}`;

  if (!fs.existsSync(filePath)) {
    // New file — write with markers
    fs.writeFileSync(filePath, wrapped, 'utf-8');
    return;
  }

  const existing = fs.readFileSync(filePath, 'utf-8');

  if (existing.includes(RELAY_SECTION_START) && existing.includes(RELAY_SECTION_END)) {
    // Replace existing relay section only
    const before = existing.substring(0, existing.indexOf(RELAY_SECTION_START));
    const after = existing.substring(existing.indexOf(RELAY_SECTION_END) + RELAY_SECTION_END.length);
    fs.writeFileSync(filePath, before + wrapped + after, 'utf-8');
  } else {
    // File exists but no relay section — append
    fs.writeFileSync(filePath, existing.trimEnd() + '\n\n' + wrapped + '\n', 'utf-8');
  }
}

function gatherLiveData(projectRoot) {
  const data = { branch: null, changedFiles: [], diffSummary: '', recentCommits: [], diff: '' };
  if (isGitRepo(projectRoot)) {
    data.branch = getCurrentBranch(projectRoot);
    data.changedFiles = getAllChangedFiles(projectRoot);
    data.diffSummary = getDiffSummary(projectRoot);
    data.recentCommits = getRecentCommits(projectRoot, 5);
    data.diff = getDiffContent(projectRoot, 150);
  }
  // Read decisions
  const decisionsPath = path.join(projectRoot, '.relay', 'decisions.log');
  data.decisions = [];
  if (fs.existsSync(decisionsPath)) {
    data.decisions = fs.readFileSync(decisionsPath, 'utf-8')
      .split('\n')
      .filter(l => l.startsWith('['))
      .slice(-10); // Last 10 decisions
  }
  // Recent history
  data.history = getHistory(projectRoot, 5);
  return data;
}

// ─── HANDOFF.md ─── The universal format any AI can read
function buildHandoffMd(state, live) {
  const task = state.current_task;
  const proj = state.project;
  const cp = state.last_checkpoint;

  let md = `# HANDOFF — ${proj.name}
> Generated by relay-dev. Read this file to continue where the last AI session stopped.
> Last updated: ${new Date().toISOString()}

## Project
- **Name**: ${proj.name}
- **Language**: ${proj.language || 'unknown'}
- **Framework**: ${proj.framework || 'none'}
- **Stack**: ${proj.tech_stack.join(', ') || 'unknown'}
- **Package manager**: ${proj.package_manager || 'unknown'}

## Current task
- **Description**: ${task.description || 'No active task'}
- **Status**: ${task.status}
${task.blocker ? `- **Blocker**: ${task.blocker}` : ''}
${task.started_at ? `- **Started**: ${task.started_at}` : ''}
${task.next_steps?.length ? `- **Next steps**: ${task.next_steps.join('; ')}` : ''}

## Last checkpoint
- **When**: ${cp.timestamp || 'never'}
- **Message**: ${cp.message || 'none'}
${cp.ai_tool ? `- **AI tool used**: ${cp.ai_tool}` : ''}
${live.branch ? `- **Git branch**: ${live.branch}` : ''}
`;

  if (live.changedFiles.length > 0) {
    md += `\n## Files with uncommitted changes\n`;
    for (const f of live.changedFiles.slice(0, 30)) {
      md += `- ${f.status}: ${f.file}\n`;
    }
    if (live.changedFiles.length > 30) {
      md += `- ... and ${live.changedFiles.length - 30} more\n`;
    }
  }

  if (live.recentCommits.length > 0) {
    md += `\n## Recent commits\n`;
    for (const c of live.recentCommits) {
      md += `- \`${c.hash}\` ${c.message}\n`;
    }
  }

  if (live.decisions.length > 0) {
    md += `\n## Key decisions made\n`;
    for (const d of live.decisions) {
      md += `- ${d}\n`;
    }
  }

  if (live.history.length > 0) {
    md += `\n## Session history (recent)\n`;
    for (const h of live.history) {
      md += `- **${h.timestamp}**: ${h.message}${h.ai_tool ? ` (${h.ai_tool})` : ''}\n`;
    }
  }

  if (live.diffSummary && live.diffSummary !== 'No changes') {
    md += `\n## Diff summary\n\`\`\`\n${live.diffSummary}\n\`\`\`\n`;
  }

  md += `\n---\n*This file is auto-generated by [relay-dev](https://github.com/thzgajendra/relay-dev). Do not edit manually — run \`npx relay checkpoint\` to update.*\n`;

  return md;
}

// ─── AGENTS.md ─── Universal agent context standard
function buildAgentsMd(state, live) {
  const proj = state.project;
  const task = state.current_task;

  return `# AGENTS.md — relay-dev context
> Auto-generated by relay-dev. Provides project context for any AI coding agent.

## Build & run commands
${guessBuildCommands(proj)}

## Current work in progress
${task.description ? `Currently working on: ${task.description}` : 'No active task.'}
${task.status !== 'idle' ? `Status: ${task.status}` : ''}
${task.blocker ? `Blocked by: ${task.blocker}` : ''}
${task.next_steps?.length ? `Next: ${task.next_steps.join(', ')}` : ''}

## Conventions
- This project uses ${proj.language || 'an unknown language'} with ${proj.framework || 'no specific framework'}.
- Package manager: ${proj.package_manager || 'unknown'}
${proj.test_runner ? `- Test runner: ${proj.test_runner}` : ''}
${proj.build_tool ? `- Build tool: ${proj.build_tool}` : ''}

## Key decisions
${live.decisions.length > 0 ? live.decisions.join('\n') : 'No decisions logged yet. Use `npx relay log "your decision"` to add them.'}
`;
}

// ─── CLAUDE.md ─── Claude Code specific
function buildClaudeMd(state, live) {
  const proj = state.project;
  const task = state.current_task;

  return `# relay-dev context for ${proj.name}

## Project
${proj.language ? `Language: ${proj.language}` : ''}
${proj.framework ? `Framework: ${proj.framework}` : ''}
Stack: ${proj.tech_stack.join(', ') || 'unknown'}

## Current task
${task.description || 'No active task'}
${task.status !== 'idle' ? `Status: ${task.status}` : ''}
${task.blocker ? `BLOCKED: ${task.blocker}` : ''}

## Commands
${guessBuildCommands(proj)}

## Decisions
${live.decisions.slice(-5).join('\n') || 'None logged.'}

## Recent changes
${live.changedFiles.slice(0, 15).map(f => `${f.status}: ${f.file}`).join('\n') || 'No uncommitted changes.'}
`;
}

// ─── Cursor rules ───
function buildCursorRules(state, live) {
  const proj = state.project;
  const task = state.current_task;

  return `---
description: Project context from relay-dev
globs: ["**/*"]
---

# Project: ${proj.name}
# Stack: ${proj.tech_stack.join(', ') || 'unknown'}
# Framework: ${proj.framework || 'none'}

# Current task: ${task.description || 'none'}
# Status: ${task.status}
${task.blocker ? `# BLOCKER: ${task.blocker}` : ''}

# Key decisions:
${live.decisions.slice(-5).map(d => `# ${d}`).join('\n') || '# None logged.'}
`;
}

// ─── Copilot instructions ───
function buildCopilotMd(state, live) {
  const proj = state.project;
  const task = state.current_task;

  return `# Copilot Instructions — relay-dev context
> Auto-generated by relay-dev

## Project context
This is a ${proj.language || ''} project${proj.framework ? ` using ${proj.framework}` : ''}.
Tech stack: ${proj.tech_stack.join(', ') || 'unknown'}.

## Current work
${task.description ? `Working on: ${task.description} (${task.status})` : 'No active task.'}
${task.blocker ? `Blocked by: ${task.blocker}` : ''}
${task.next_steps?.length ? `Next steps: ${task.next_steps.join(', ')}` : ''}

## Key decisions
${live.decisions.slice(-5).join('\n') || 'None logged.'}
`;
}

function guessBuildCommands(proj) {
  const pm = proj.package_manager || 'npm';
  const run = pm === 'yarn' ? 'yarn' : pm === 'pnpm' ? 'pnpm' : pm === 'bun' ? 'bun' : 'npm run';
  const install = pm === 'yarn' ? 'yarn' : `${pm} install`;

  let cmds = `- Install: \`${install}\`\n`;
  cmds += `- Dev: \`${run} dev\`\n`;
  cmds += `- Build: \`${run} build\`\n`;
  if (proj.test_runner) cmds += `- Test: \`${run} test\`\n`;
  cmds += `- Lint: \`${run} lint\`\n`;

  return cmds;
}

module.exports = { generate, safeWriteContextFile, RELAY_SECTION_START, RELAY_SECTION_END };
