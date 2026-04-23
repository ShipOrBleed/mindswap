const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');

const { readState, getDataDir, getHistory } = require('./state');
const { isGitRepo, getCurrentBranch, getAllChangedFiles, getRecentCommits } = require('./git');
const { buildNarrative, buildCompactNarrative, calculateQualityScore } = require('./narrative');
const { findAllConflicts, checkDepsVsDecisions } = require('./conflicts');
const { detectAITool } = require('./detect-ai');
const { detectMonorepo, getMonorepoSection, detectChangedPackages } = require('./monorepo');
const { appendMemoryItem, getOpenMemoryItems, getRecentMemoryItems } = require('./memory');

/**
 * Start the mindswap MCP server.
 * 3 tools. That's it.
 */
async function startMCPServer() {
  const projectRoot = process.cwd();

  const server = new McpServer({
    name: 'mindswap',
    version: '2.2.0',
    description: 'Project context for AI coding tools. One call gives you everything you need to continue where the last session stopped.',
  });

  // ═══════════════════════════════════════════════════
  // TOOL 1: mindswap_get_context
  // THE critical tool. Called at session start.
  // Returns synthesized project state in one response.
  // ═══════════════════════════════════════════════════
  server.tool(
    'mindswap_get_context',
    `Get complete project context for this coding session. Call this FIRST when starting work on a project. Returns: project info, current task, recent decisions, what's in-progress, conventions, conflicts, and test status — all synthesized into a single briefing.`,
    {
      focus: z.enum(['all', 'task', 'decisions', 'recent']).default('all')
        .describe('What to focus on: "all" for full context, "task" for current work only, "decisions" for architecture decisions, "recent" for latest changes'),
      compact: z.boolean().default(false)
        .describe('Return token-optimized compact format (fewer tokens, same info)'),
    },
    async ({ focus, compact }) => {
      return getContext(projectRoot, focus, compact);
    }
  );

  // ═══════════════════════════════════════════════════
  // TOOL 2: mindswap_save_context
  // Called when the AI has done meaningful work.
  // Persists what was done, decisions made, what's next.
  // ═══════════════════════════════════════════════════
  server.tool(
    'mindswap_save_context',
    `Save session context before ending work or when significant progress is made. Records what was accomplished, decisions made, and what should happen next. This ensures the next AI session (in any tool) can pick up seamlessly.`,
    {
      summary: z.string().describe('Brief summary of what was done in this session'),
      decisions: z.array(z.string()).optional()
        .describe('Key decisions made during this session (e.g., "chose JWT over sessions for stateless API")'),
      assumptions: z.array(z.string()).optional()
        .describe('Assumptions made during this session that should carry forward'),
      questions: z.array(z.string()).optional()
        .describe('Open questions that remain unresolved'),
      resolutions: z.array(z.string()).optional()
        .describe('Resolved items or conclusions reached during this session'),
      next_steps: z.array(z.string()).optional()
        .describe('What should be done next'),
      blocker: z.string().optional()
        .describe('Any blocker or issue discovered'),
      task_status: z.enum(['in_progress', 'blocked', 'paused', 'completed']).optional()
        .describe('Update task status'),
    },
    async ({ summary, decisions, assumptions, questions, resolutions, next_steps, blocker, task_status }) => {
      return saveContext(projectRoot, { summary, decisions, assumptions, questions, resolutions, next_steps, blocker, task_status });
    }
  );

  // ═══════════════════════════════════════════════════
  // TOOL 3: mindswap_search
  // Called mid-session when AI needs specific context.
  // Natural language search over decisions and history.
  // ═══════════════════════════════════════════════════
  server.tool(
    'mindswap_search',
    `Search project context for specific information. Use when you need to know about a past decision, convention, or what happened with a specific feature. Searches decisions log, session history, and project state.`,
    {
      query: z.string().describe('What to search for (e.g., "auth", "database choice", "why Redis")'),
      type: z.enum(['all', 'decisions', 'history']).default('all')
        .describe('Where to search: "all" searches everything, "decisions" only searches decision log, "history" only searches session history'),
    },
    async ({ query, type }) => {
      return searchContext(projectRoot, query, type);
    }
  );

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// ═══════════════════════════════════════════════════
// Tool implementations
// ═══════════════════════════════════════════════════

function getContext(projectRoot, focus, compact) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    return {
      content: [{
        type: 'text',
        text: 'mindswap not initialized in this project. Run `npx mindswap init` first.',
      }],
    };
  }

  const state = readState(projectRoot);
  const liveData = gatherLiveData(projectRoot);

  if (compact) {
    const compactText = buildCompactNarrative(state, liveData);
    return { content: [{ type: 'text', text: compactText }] };
  }

  const sections = [];

  // Always include narrative TL;DR
  const narrative = buildNarrative(state, liveData);
  sections.push(`## TL;DR\n${narrative}`);

  if (focus === 'all' || focus === 'task') {
    const task = state.current_task;
    if (task.description && task.status !== 'idle') {
      let taskSection = `## Current Task\n- **${task.description}** [${task.status}]`;
      if (task.blocker) taskSection += `\n- BLOCKER: ${task.blocker}`;
      if (task.next_steps?.length) taskSection += `\n- Next: ${task.next_steps.join(', ')}`;
      sections.push(taskSection);
    }

    // Test status
    if (state.test_status?.passed != null) {
      const ts = state.test_status;
      const status = ts.failed > 0 ? `FAILING (${ts.failed} failed)` : 'passing';
      sections.push(`## Tests\n${ts.passed} ${status}`);
    }
  }

  if (focus === 'all' || focus === 'decisions') {
    if (liveData.decisions.length > 0) {
      const stripped = liveData.decisions.slice(-10).map(d =>
        d.replace(/^\[.*?\]\s*\[.*?\]\s*/, '').trim()
      );
      sections.push(`## Decisions\n${stripped.map(d => `- ${d}`).join('\n')}`);
    }

    const memoryLines = formatMemorySection(projectRoot);
    if (memoryLines.length > 0) {
      sections.push(`## Structured Memory\n${memoryLines.join('\n')}`);
    }

    // Conflicts
    const conflicts = findAllConflicts(projectRoot);
    const depConflicts = checkDepsVsDecisions(projectRoot);
    if (conflicts.length + depConflicts.length > 0) {
      const conflictLines = [
        ...conflicts.map(c => `- WARNING: ${c.reason}`),
        ...depConflicts.map(c => `- WARNING: ${c.reason}`),
      ];
      sections.push(`## Conflicts\n${conflictLines.join('\n')}`);
    }
  }

  if (focus === 'all' || focus === 'recent') {
    // Recent commits
    if (liveData.recentCommits.length > 0) {
      const commitLines = liveData.recentCommits.slice(0, 5)
        .map(c => `- \`${c.hash}\` ${c.message}`);
      sections.push(`## Recent Commits\n${commitLines.join('\n')}`);
    }

    // Changed files (grouped)
    if (liveData.changedFiles.length > 0) {
      sections.push(`## Uncommitted Changes\n${liveData.changedFiles.length} files changed`);
    }
  }

  if (focus === 'all') {
    // Project info
    const proj = state.project;
    sections.push(`## Project\n- ${proj.name} (${[proj.language, proj.framework].filter(Boolean).join('/')})` +
      `\n- Stack: ${proj.tech_stack?.join(', ') || 'unknown'}` +
      `\n- Branch: ${liveData.branch || 'unknown'}`);

    // Monorepo
    const monorepo = detectMonorepo(projectRoot);
    if (monorepo.isMonorepo) {
      const changedPkgs = detectChangedPackages(monorepo, liveData.changedFiles);
      sections.push(`## Monorepo (${monorepo.tool})\n${monorepo.packages.length} packages` +
        (changedPkgs.length > 0 ? `\nChanges in: ${changedPkgs.join(', ')}` : ''));
    }

    // Quality score
    const quality = calculateQualityScore(state, liveData);
    if (quality.score < 75 && quality.missing.length > 0) {
      sections.push(`## Context Quality: ${quality.grade} (${quality.score}/100)\nMissing: ${quality.missing[0]}`);
    }
  }

  return {
    content: [{
      type: 'text',
      text: sections.join('\n\n'),
    }],
  };
}

function saveContext(projectRoot, { summary, decisions, assumptions, questions, resolutions, next_steps, blocker, task_status }) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    return {
      content: [{ type: 'text', text: 'mindswap not initialized. Run `npx mindswap init` first.' }],
    };
  }

  const now = new Date().toISOString();
  const { updateState, addToHistory } = require('./state');

  // Update task state
  const taskUpdates = {};
  if (summary) taskUpdates.description = summary;
  if (next_steps?.length) taskUpdates.next_steps = next_steps;
  if (blocker) taskUpdates.blocker = blocker;
  if (task_status) taskUpdates.status = task_status;
  if (task_status === 'completed') {
    taskUpdates.description = '';
    taskUpdates.status = 'idle';
    taskUpdates.blocker = null;
    taskUpdates.next_steps = [];
  }

  const updates = {};
  if (Object.keys(taskUpdates).length > 0) {
    updates.current_task = taskUpdates;
  }
  updates.last_checkpoint = {
    timestamp: now,
    message: summary || 'saved via MCP',
    ai_tool: detectAITool(projectRoot),
  };

  updateState(projectRoot, updates);

  // Log decisions
  if (decisions?.length > 0) {
    const decisionsPath = path.join(dataDir, 'decisions.log');
    for (const d of decisions) {
      fs.appendFileSync(decisionsPath, `[${now}] [ai-session] ${d}\n`);
      appendMemoryItem(projectRoot, { type: 'decision', tag: 'ai-session', message: d, created_at: now, source: 'mcp' });
    }
  }
  if (assumptions?.length > 0) {
    for (const item of assumptions) {
      appendMemoryItem(projectRoot, { type: 'assumption', tag: 'ai-session', message: item, created_at: now, source: 'mcp' });
    }
  }
  if (questions?.length > 0) {
    for (const item of questions) {
      appendMemoryItem(projectRoot, { type: 'question', tag: 'ai-session', message: item, created_at: now, source: 'mcp' });
    }
  }
  if (resolutions?.length > 0) {
    for (const item of resolutions) {
      appendMemoryItem(projectRoot, {
        type: 'resolution',
        tag: 'ai-session',
        message: item,
        created_at: now,
        resolved_at: now,
        status: 'resolved',
        source: 'mcp',
      });
    }
  }
  if (blocker) {
    appendMemoryItem(projectRoot, { type: 'blocker', tag: 'ai-session', message: blocker, created_at: now, source: 'mcp' });
  }

  // Save to history
  addToHistory(projectRoot, {
    timestamp: now,
    message: summary || 'saved via MCP',
    type: 'mcp_save',
    decisions: decisions || [],
    assumptions: assumptions || [],
    questions: questions || [],
    resolutions: resolutions || [],
    next_steps: next_steps || [],
  });

  // Regenerate HANDOFF.md
  try {
    const { generate } = require('./generate');
    generate(projectRoot, { handoff: true, quiet: true });
  } catch (err) {
    try { process.stderr.write(`mindswap MCP: HANDOFF.md generation failed: ${err.message}\n`); } catch {}
  }

  const saved = [];
  if (summary) saved.push('summary');
  if (decisions?.length) saved.push(`${decisions.length} decisions`);
  if (assumptions?.length) saved.push(`${assumptions.length} assumptions`);
  if (questions?.length) saved.push(`${questions.length} questions`);
  if (resolutions?.length) saved.push(`${resolutions.length} resolutions`);
  if (next_steps?.length) saved.push('next steps');
  if (blocker) saved.push('blocker');
  if (task_status) saved.push(`status → ${task_status}`);

  return {
    content: [{
      type: 'text',
      text: `Context saved: ${saved.join(', ')}. HANDOFF.md updated.`,
    }],
  };
}

function searchContext(projectRoot, query, type) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    return {
      content: [{ type: 'text', text: 'mindswap not initialized. Run `npx mindswap init` first.' }],
    };
  }

  const queryLower = query.toLowerCase();
  const results = [];

  // Search decisions
  if (type === 'all' || type === 'decisions') {
    const decisionsPath = path.join(dataDir, 'decisions.log');
    if (fs.existsSync(decisionsPath)) {
      const lines = fs.readFileSync(decisionsPath, 'utf-8')
        .split('\n')
        .filter(l => l.startsWith('['));

      for (const line of lines) {
        if (line.toLowerCase().includes(queryLower)) {
          results.push({ type: 'decision', content: line });
        }
      }
    }
  }

  // Search history
  if (type === 'all' || type === 'history') {
    const history = getHistory(projectRoot, 50);
    for (const entry of history) {
      const entryStr = JSON.stringify(entry).toLowerCase();
      if (entryStr.includes(queryLower)) {
        results.push({
          type: 'history',
          content: `[${entry.timestamp}] ${entry.message}${entry.ai_tool ? ` (${entry.ai_tool})` : ''}`,
        });
      }
    }
  }

  // Search current state
  if (type === 'all') {
    const memoryItems = getRecentMemoryItems(projectRoot, 50);
    for (const item of memoryItems) {
      if (item.message.toLowerCase().includes(queryLower)) {
        results.push({ type: item.type, content: `${item.message} [${item.status}]` });
      }
    }

    const state = readState(projectRoot);
    const stateStr = JSON.stringify(state).toLowerCase();
    if (stateStr.includes(queryLower)) {
      if (state.current_task?.description?.toLowerCase().includes(queryLower)) {
        results.push({ type: 'task', content: `Current task: ${state.current_task.description} [${state.current_task.status}]` });
      }
      if (state.project?.tech_stack?.some(t => t.toLowerCase().includes(queryLower))) {
        results.push({ type: 'project', content: `Tech stack includes: ${state.project.tech_stack.join(', ')}` });
      }
    }
  }

  if (results.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `No results for "${query}". Try broader terms or log more decisions with: npx mindswap log "your decision"`,
      }],
    };
  }

  const formatted = results.slice(0, 15).map(r => `[${r.type}] ${r.content}`).join('\n');
  return {
    content: [{
      type: 'text',
      text: `Found ${results.length} result(s) for "${query}":\n\n${formatted}`,
    }],
  };
}

// ═══════════════════════════════════════════════════
// Helper — gather live project data
// ═══════════════════════════════════════════════════

function gatherLiveData(projectRoot) {
  const data = {
    branch: null,
    changedFiles: [],
    recentCommits: [],
    decisions: [],
    history: [],
  };

  if (isGitRepo(projectRoot)) {
    data.branch = getCurrentBranch(projectRoot);
    data.changedFiles = getAllChangedFiles(projectRoot);
    data.recentCommits = getRecentCommits(projectRoot, 5);
  }

  const decisionsPath = path.join(projectRoot, '.mindswap', 'decisions.log');
  if (fs.existsSync(decisionsPath)) {
    data.decisions = fs.readFileSync(decisionsPath, 'utf-8')
      .split('\n')
      .filter(l => l.startsWith('['));
  }

  data.structuredMemory = getRecentMemoryItems(projectRoot, 20);
  data.history = getHistory(projectRoot, 5);
  return data;
}

function formatMemorySection(projectRoot) {
  const lines = [];
  for (const item of getOpenMemoryItems(projectRoot, 'blocker', 5)) lines.push(`- BLOCKER: ${item.message}`);
  for (const item of getOpenMemoryItems(projectRoot, 'question', 5)) lines.push(`- QUESTION: ${item.message}`);
  for (const item of getOpenMemoryItems(projectRoot, 'assumption', 5)) lines.push(`- ASSUMPTION: ${item.message}`);
  for (const item of getRecentMemoryItems(projectRoot, 10).filter(item => item.type === 'resolution').slice(-5)) {
    lines.push(`- RESOLUTION: ${item.message}`);
  }
  return lines;
}

module.exports = { startMCPServer };
