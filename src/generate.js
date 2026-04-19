const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { readState, getDataDir, getHistory } = require('./state');
const { isGitRepo, getCurrentBranch, getAllChangedFiles, getDiffSummary, getDiffContent, getRecentCommits } = require('./git');
const { buildNarrative, buildCompactNarrative, summarizeFiles } = require('./narrative');

const SECTION_START = '<!-- mindswap:start -->';
const SECTION_END = '<!-- mindswap:end -->';

async function generate(projectRoot, opts = {}) {
  const state = readState(projectRoot);
  const dataDir = getDataDir(projectRoot);

  const generateAll = opts.all;
  const generateHandoff = opts.handoff || (!opts.claude && !opts.cursor && !opts.copilot && !opts.agents && !opts.compact);

  const liveData = gatherLiveData(projectRoot);

  // Compact mode — token-optimized single file
  if (opts.compact) {
    const compact = buildCompactNarrative(state, liveData);
    fs.writeFileSync(path.join(dataDir, 'HANDOFF.compact.md'), compact, 'utf-8');
    fs.writeFileSync(path.join(projectRoot, 'HANDOFF.md'), compact, 'utf-8');
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + 'HANDOFF.md (compact — token-optimized)');
    if (!opts.quiet) console.log(chalk.bold.green('\n✓ Compact context generated\n'));
    return;
  }

  // HANDOFF.md (core — fully owned by mindswap)
  if (generateHandoff || generateAll) {
    const handoff = buildHandoffMd(state, liveData);
    fs.writeFileSync(path.join(dataDir, 'HANDOFF.md'), handoff, 'utf-8');
    fs.writeFileSync(path.join(projectRoot, 'HANDOFF.md'), handoff, 'utf-8');
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + 'HANDOFF.md');
  }

  // AGENTS.md — safe merge
  if (opts.agents || generateAll) {
    const agents = buildAgentsMd(state, liveData);
    safeWriteContextFile(path.join(projectRoot, 'AGENTS.md'), agents);
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + 'AGENTS.md');
  }

  // CLAUDE.md — safe merge
  if (opts.claude || generateAll) {
    const claude = buildClaudeMd(state, liveData);
    safeWriteContextFile(path.join(projectRoot, 'CLAUDE.md'), claude);
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + 'CLAUDE.md');
  }

  // .cursor/rules
  if (opts.cursor || generateAll) {
    const cursorRulesDir = path.join(projectRoot, '.cursor', 'rules');
    if (!fs.existsSync(cursorRulesDir)) fs.mkdirSync(cursorRulesDir, { recursive: true });
    const cursorRules = buildCursorRules(state, liveData);
    fs.writeFileSync(path.join(cursorRulesDir, 'mindswap-context.mdc'), cursorRules, 'utf-8');
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + '.cursor/rules/mindswap-context.mdc');
  }

  // .github/copilot-instructions.md — safe merge
  if (opts.copilot || generateAll) {
    const ghDir = path.join(projectRoot, '.github');
    if (!fs.existsSync(ghDir)) fs.mkdirSync(ghDir, { recursive: true });
    const copilot = buildCopilotMd(state, liveData);
    safeWriteContextFile(path.join(ghDir, 'copilot-instructions.md'), copilot);
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + '.github/copilot-instructions.md');
  }

  if (!opts.quiet) {
    console.log(chalk.bold.green('\n✓ Context files generated\n'));
  }
}

/**
 * Safely writes mindswap content to a file without overwriting user content.
 */
function safeWriteContextFile(filePath, content) {
  const wrapped = `${SECTION_START}\n${content}\n${SECTION_END}`;

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, wrapped, 'utf-8');
    return;
  }

  const existing = fs.readFileSync(filePath, 'utf-8');

  if (existing.includes(SECTION_START) && existing.includes(SECTION_END)) {
    const before = existing.substring(0, existing.indexOf(SECTION_START));
    const after = existing.substring(existing.indexOf(SECTION_END) + SECTION_END.length);
    fs.writeFileSync(filePath, before + wrapped + after, 'utf-8');
  } else {
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
  const decisionsPath = path.join(projectRoot, '.mindswap', 'decisions.log');
  data.decisions = [];
  if (fs.existsSync(decisionsPath)) {
    data.decisions = fs.readFileSync(decisionsPath, 'utf-8')
      .split('\n')
      .filter(l => l.startsWith('['))
      .slice(-10);
  }
  data.history = getHistory(projectRoot, 5);
  return data;
}

function buildHandoffMd(state, live) {
  const task = state.current_task;
  const proj = state.project;
  const cp = state.last_checkpoint;

  // Generate smart narrative summary
  const narrative = buildNarrative(state, live);

  let md = `# HANDOFF — ${proj.name}
> Generated by mindswap. Read this file to continue where the last AI session stopped.
> Last updated: ${new Date().toISOString()}

## TL;DR
${narrative}

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
`;

  // Build/test status
  if (state.test_status) {
    const ts = state.test_status;
    let detail = ts.status;
    if (ts.passed != null) detail = `${ts.passed} passed, ${ts.failed || 0} failed`;
    md += `\n## Test status\n- **Result**: ${detail}\n`;
  }
  if (state.build_status) {
    md += `- **Build**: ${state.build_status.status}\n`;
  }

  md += `\n## Last checkpoint
- **When**: ${cp.timestamp || 'never'}
- **Message**: ${cp.message || 'none'}
${cp.ai_tool ? `- **AI tool used**: ${cp.ai_tool}` : ''}
${live.branch ? `- **Git branch**: ${live.branch}` : ''}
`;

  if (live.changedFiles.length > 0) {
    md += `\n## Files with uncommitted changes (${live.changedFiles.length} total)\n`;
    for (const f of live.changedFiles.slice(0, 30)) {
      md += `- ${f.status}: ${f.file}\n`;
    }
    if (live.changedFiles.length > 30) {
      md += `- ... and ${live.changedFiles.length - 30} more files\n`;
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

  md += `\n---\n*Auto-generated by [mindswap](https://github.com/thzgajendra/mindswap). Run \`npx mindswap cp\` to update.*\n`;

  return md;
}

function buildAgentsMd(state, live) {
  const proj = state.project;
  const task = state.current_task;

  return `# AGENTS.md — mindswap context
> Auto-generated by mindswap. Provides project context for any AI coding agent.

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
${live.decisions.length > 0 ? live.decisions.join('\n') : 'No decisions logged yet. Use `npx mindswap log "your decision"` to add them.'}
`;
}

function buildClaudeMd(state, live) {
  const proj = state.project;
  const task = state.current_task;

  return `# mindswap context for ${proj.name}

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

function buildCursorRules(state, live) {
  const proj = state.project;
  const task = state.current_task;

  return `---
description: Project context from mindswap
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

function buildCopilotMd(state, live) {
  const proj = state.project;
  const task = state.current_task;

  return `# Copilot Instructions — mindswap context
> Auto-generated by mindswap

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

  // Go projects
  if (pm === 'go modules' || proj.language === 'go') {
    let cmds = `- Install: \`go mod download\`\n`;
    cmds += `- Build: \`go build ./...\`\n`;
    cmds += `- Test: \`go test ./...\`\n`;
    cmds += `- Lint: \`golangci-lint run\`\n`;
    return cmds;
  }

  // Python projects
  if (proj.language === 'python') {
    const pip = pm === 'poetry' ? 'poetry' : pm === 'pipenv' ? 'pipenv' : 'pip';
    let cmds = `- Install: \`${pip} install\`\n`;
    cmds += `- Test: \`pytest\`\n`;
    cmds += `- Lint: \`ruff check .\`\n`;
    return cmds;
  }

  // Rust projects
  if (pm === 'cargo' || proj.language === 'rust') {
    let cmds = `- Build: \`cargo build\`\n`;
    cmds += `- Test: \`cargo test\`\n`;
    cmds += `- Lint: \`cargo clippy\`\n`;
    return cmds;
  }

  // JS/TS projects (default)
  const run = pm === 'yarn' ? 'yarn' : pm === 'pnpm' ? 'pnpm' : pm === 'bun' ? 'bun' : 'npm run';
  const install = pm === 'yarn' ? 'yarn' : `${pm} install`;

  let cmds = `- Install: \`${install}\`\n`;
  cmds += `- Dev: \`${run} dev\`\n`;
  cmds += `- Build: \`${run} build\`\n`;
  if (proj.test_runner) cmds += `- Test: \`${run} test\`\n`;
  cmds += `- Lint: \`${run} lint\`\n`;

  return cmds;
}

module.exports = { generate, safeWriteContextFile, SECTION_START, SECTION_END };
