const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { readState, getDataDir, getHistory } = require('./state');
const { isGitRepo, getCurrentBranch, getAllChangedFiles, getDiffSummary, getDiffContent, getRecentCommits } = require('./git');
const { buildNarrative, buildCompactNarrative, summarizeFiles } = require('./narrative');
const { scanAndRedact, printSecretWarnings } = require('./secrets');
const { detectMonorepo, getMonorepoSection, detectChangedPackages } = require('./monorepo');
const { teamSection } = require('./team');
const { getOpenMemoryItems, getMemoryItems } = require('./memory');
const { parseNativeSessions, getSessionSummary } = require('./session-parser');
const { analyzeGuardrails, buildGuardrailSection } = require('./guardrails');

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
    const handoff = buildHandoffMd(state, liveData, projectRoot);
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

  // GEMINI.md — safe merge (Google Gemini CLI)
  if (opts.gemini || generateAll) {
    const gemini = buildToolContextMd(state, liveData, 'Gemini CLI');
    safeWriteContextFile(path.join(projectRoot, 'GEMINI.md'), gemini);
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + 'GEMINI.md');
  }

  // .windsurfrules — own file (Windsurf IDE)
  if (opts.windsurf || generateAll) {
    const windsurf = buildCursorRules(state, liveData); // Same format as cursor rules
    fs.writeFileSync(path.join(projectRoot, '.windsurfrules'), windsurf, 'utf-8');
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + '.windsurfrules');
  }

  // .cline/rules — own file (Cline)
  if (opts.cline || generateAll) {
    const clineDir = path.join(projectRoot, '.cline');
    if (!fs.existsSync(clineDir)) fs.mkdirSync(clineDir, { recursive: true });
    const cline = buildToolContextMd(state, liveData, 'Cline');
    fs.writeFileSync(path.join(clineDir, 'mindswap-context.md'), cline, 'utf-8');
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + '.cline/mindswap-context.md');
  }

  // .roo/rules — own file (Roo Code)
  if (opts.roo || generateAll) {
    const rooDir = path.join(projectRoot, '.roo', 'rules');
    if (!fs.existsSync(rooDir)) fs.mkdirSync(rooDir, { recursive: true });
    const roo = buildToolContextMd(state, liveData, 'Roo Code');
    fs.writeFileSync(path.join(rooDir, 'mindswap-context.md'), roo, 'utf-8');
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + '.roo/rules/mindswap-context.md');
  }

  // CONVENTIONS.md — safe merge (Aider)
  if (opts.aider || generateAll) {
    const aider = buildToolContextMd(state, liveData, 'Aider');
    safeWriteContextFile(path.join(projectRoot, 'CONVENTIONS.md'), aider);
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + 'CONVENTIONS.md');
  }

  // .amp/rules — own file (Amp)
  if (opts.amp || generateAll) {
    const ampDir = path.join(projectRoot, '.amp');
    if (!fs.existsSync(ampDir)) fs.mkdirSync(ampDir, { recursive: true });
    const amp = buildToolContextMd(state, liveData, 'Amp');
    fs.writeFileSync(path.join(ampDir, 'mindswap-context.md'), amp, 'utf-8');
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + '.amp/mindswap-context.md');
  }

  // CODEX.md — safe merge (OpenAI Codex CLI)
  if (opts.codex || generateAll) {
    const codex = buildToolContextMd(state, liveData, 'Codex');
    safeWriteContextFile(path.join(projectRoot, 'CODEX.md'), codex);
    if (!opts.quiet) console.log(chalk.green('  ✓ ') + 'CODEX.md');
  }

  if (!opts.quiet) {
    console.log(chalk.bold.green('\n✓ Context files generated\n'));
  }
}

/**
 * Safely writes mindswap content to a file without overwriting user content.
 * Scans for secrets before writing.
 */
function safeWriteContextFile(filePath, content) {
  // Scan for secrets and redact
  const scan = scanAndRedact(content, path.basename(filePath));
  if (!scan.clean) {
    printSecretWarnings(scan.findings, path.basename(filePath));
    content = scan.content;
  }
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
  data.structuredMemory = getStructuredMemory(projectRoot);
  data.history = getHistory(projectRoot, 5);
  data.nativeSessions = parseNativeSessions(projectRoot);
  data.guardrails = analyzeGuardrails(projectRoot, {
    changedFiles: data.changedFiles,
    diffContent: data.diff,
  });
  return data;
}

function buildHandoffMd(state, live, projectRoot) {
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

  const memoryLines = formatStructuredMemoryLines(live.structuredMemory);
  if (memoryLines.length > 0) {
    md += `\n## Structured memory\n`;
    for (const line of memoryLines) {
      md += `${line}\n`;
    }
  }

  if (live.history.length > 0) {
    md += `\n## Session history (recent)\n`;
    for (const h of live.history) {
      const author = h.author ? ` — ${h.author}` : '';
      md += `- **${h.timestamp}**${author}: ${h.message}${h.ai_tool ? ` (${h.ai_tool})` : ''}\n`;
    }
  }

  const teamInfo = teamSection(projectRoot, live.history);
  if (teamInfo) {
    md += `\n${teamInfo}\n`;
  }

  if (live.nativeSessions?.length > 0) {
    const sessionSummary = getSessionSummary(live.nativeSessions);
    if (sessionSummary.trim()) {
      md += `\n${sessionSummary}\n`;
    }
  }

  const guardrailSection = buildGuardrailSection(live.guardrails);
  if (guardrailSection) {
    md += `\n${guardrailSection}\n`;
  }

  if (live.diffSummary && live.diffSummary !== 'No changes') {
    md += `\n## Diff summary\n\`\`\`\n${live.diffSummary}\n\`\`\`\n`;
  }

  // Monorepo section
  const monorepo = detectMonorepo(projectRoot || '.');
  if (monorepo.isMonorepo) {
    md += getMonorepoSection(monorepo);
    const changedPkgs = detectChangedPackages(monorepo, live.changedFiles);
    if (changedPkgs.length > 0) {
      md += `\n\n**Packages with changes:** ${changedPkgs.join(', ')}\n`;
    }
  }

  md += `\n---\n*Auto-generated by [mindswap](https://github.com/ShipOrBleed/mindswap). Run \`npx mindswap\` to update.*\n`;

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

## Structured memory
${formatStructuredMemoryText(live.structuredMemory)}
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

## Structured memory
${formatStructuredMemoryText(live.structuredMemory)}

${buildGuardrailSection(live.guardrails)}

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

# Structured memory:
${formatStructuredMemoryLines(live.structuredMemory).map(line => `# ${line.slice(2)}`).join('\n') || '# None logged.'}
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

## Structured memory
${formatStructuredMemoryText(live.structuredMemory)}
`;
}

// ─── Generic tool context (works for Gemini, Cline, Roo, Amp, Aider, Codex) ───
function buildToolContextMd(state, live, toolName) {
  const proj = state.project;
  const task = state.current_task;
  const narrative = buildNarrative(state, live);

  return `# ${toolName} context — mindswap
> Auto-generated by mindswap. Project context for ${toolName}.

## Summary
${narrative}

## Project
- Language: ${proj.language || 'unknown'}
- Framework: ${proj.framework || 'none'}
- Stack: ${proj.tech_stack.join(', ') || 'unknown'}
- Package manager: ${proj.package_manager || 'unknown'}

## Current task
${task.description || 'No active task'}
${task.status !== 'idle' ? `Status: ${task.status}` : ''}
${task.blocker ? `BLOCKED: ${task.blocker}` : ''}
${task.next_steps?.length ? `Next: ${task.next_steps.join(', ')}` : ''}

## Commands
${guessBuildCommands(proj)}

## Decisions
${live.decisions.slice(-7).map(d => d.replace(/^\[.*?\]\s*/, '')).join('\n') || 'None logged.'}

## Structured memory
${formatStructuredMemoryText(live.structuredMemory)}

${buildGuardrailSection(live.guardrails)}

## Recent changes
${live.changedFiles.slice(0, 15).map(f => `${f.status}: ${f.file}`).join('\n') || 'No uncommitted changes.'}
`;
}

function getStructuredMemory(projectRoot) {
  return {
    blockers: getOpenMemoryItems(projectRoot, 'blocker', 5),
    assumptions: getOpenMemoryItems(projectRoot, 'assumption', 5),
    questions: getOpenMemoryItems(projectRoot, 'question', 5),
    resolutions: getMemoryItems(projectRoot, { type: 'resolution', limit: 5 }),
  };
}

function formatStructuredMemoryLines(memory) {
  const lines = [];
  for (const item of memory.blockers || []) lines.push(`- BLOCKER: ${item.message}`);
  for (const item of memory.questions || []) lines.push(`- QUESTION: ${item.message}`);
  for (const item of memory.assumptions || []) lines.push(`- ASSUMPTION: ${item.message}`);
  for (const item of memory.resolutions || []) lines.push(`- RESOLUTION: ${item.message}`);
  return lines;
}

function formatStructuredMemoryText(memory) {
  const lines = formatStructuredMemoryLines(memory);
  return lines.join('\n') || 'No structured memory logged yet.';
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
