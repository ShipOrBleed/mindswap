const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const http = require('http');
const { randomUUID } = require('crypto');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');

const { readState, getDataDir, getHistory } = require('./state');
const { buildNarrative, buildCompactNarrative, calculateQualityScore } = require('./narrative');
const { findAllConflicts, checkDepsVsDecisions } = require('./conflicts');
const { detectAITool } = require('./detect-ai');
const { detectMonorepo, getMonorepoSection, detectChangedPackages } = require('./monorepo');
const { importSessions } = require('./session-import');
const {
  MEMORY_TYPES,
  MEMORY_STATUSES,
  appendMemoryItem,
  getMemoryItemById,
  getOpenMemoryItems,
  getRecentMemoryItems,
  listMemoryItems,
  readMemory,
  updateMemoryItem,
  resolveMemoryItem,
  archiveMemoryItem,
  deleteMemoryItem,
} = require('./memory');
const { parseNativeSessions, getSessionSummary } = require('./session-parser');
const { analyzeGuardrails, buildGuardrailSection } = require('./guardrails');
const { buildResumeBriefing, gatherResumeData } = require('./resume');
const { createProjectSnapshot, readDecisionLines } = require('./project-snapshot');

/**
 * Start the mindswap MCP server.
 * Core tools for context, saving, search, and structured memory.
 */
function createMCPServer(projectRoot) {
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
      const snapshot = createProjectSnapshot(projectRoot, getSnapshotOptionsForContext(focus, compact));
      return getContext(projectRoot, focus, compact, snapshot);
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
      const snapshot = createProjectSnapshot(projectRoot, getSnapshotOptionsForSearch(type));
      return searchContext(projectRoot, query, type, snapshot);
    }
  );

  // ═══════════════════════════════════════════════════
  // TOOL 4: mindswap_memory
  // Structured memory CRUD for blockers, questions, assumptions, resolutions.
  // ═══════════════════════════════════════════════════
  server.tool(
    'mindswap_memory',
    `Manage structured memory items. Use this to list, add, update, resolve, archive, or delete blockers, assumptions, questions, and resolutions.`,
    {
      action: z.enum(['list', 'get', 'add', 'update', 'resolve', 'archive', 'delete'])
        .describe('Operation to perform on memory'),
      id: z.string().optional()
        .describe('Memory item id for get/update/resolve/archive/delete'),
      type: z.enum([...MEMORY_TYPES]).optional()
        .describe('Memory type for add or filtering'),
      message: z.string().optional()
        .describe('Message for add/update'),
      tag: z.string().optional()
        .describe('Tag for add/update or filtering'),
      status: z.enum([...MEMORY_STATUSES]).optional()
        .describe('Status for add/update or filtering'),
      author: z.string().optional()
        .describe('Author for add/update or filtering'),
      source: z.string().optional()
        .describe('Source for add/update or filtering'),
      limit: z.number().int().positive().max(200).optional()
        .describe('Max number of items to return when listing'),
      after: z.string().optional()
        .describe('Only include items created after this timestamp'),
      before: z.string().optional()
        .describe('Only include items created before this timestamp'),
      hard: z.boolean().default(false)
        .describe('Hard delete instead of archiving'),
      json: z.boolean().default(false)
        .describe('Return JSON instead of formatted text'),
    },
    async (args) => {
      return manageMemory(projectRoot, args);
    }
  );

  // ═══════════════════════════════════════════════════
  // RESOURCES: stable read-only artifacts for clients
  // ═══════════════════════════════════════════════════
  server.registerResource(
    'mindswap_context_current',
    'mindswap://context/current',
    {
      title: 'Current Context',
      description: 'The current synthesized project context in text form.',
    },
    async () => readStableResource(projectRoot, 'context')
  );

  server.registerResource(
    'mindswap_state_current',
    'mindswap://state/current',
    {
      title: 'Current State',
      description: 'The current machine-readable mindswap state as JSON.',
    },
    async () => readStableResource(projectRoot, 'state')
  );

  server.registerResource(
    'mindswap_decisions_recent',
    'mindswap://decisions/recent',
    {
      title: 'Recent Decisions',
      description: 'Recent decisions and conflict signals as JSON.',
    },
    async () => readStableResource(projectRoot, 'decisions')
  );

  server.registerResource(
    'mindswap_memory_current',
    'mindswap://memory/current',
    {
      title: 'Structured Memory',
      description: 'All structured memory items as JSON.',
    },
    async () => readStableResource(projectRoot, 'memory')
  );

  server.registerResource(
    'mindswap_handoff_current',
    'mindswap://handoff/current',
    {
      title: 'Current Handoff',
      description: 'The generated HANDOFF.md content or a synthesized fallback.',
    },
    async () => readStableResource(projectRoot, 'handoff')
  );

  // ═══════════════════════════════════════════════════
  // PROMPTS: workflow templates for common handoff actions
  // ═══════════════════════════════════════════════════
  server.registerPrompt(
    'mindswap_start_work',
    {
      title: 'Start Work',
      description: 'Prepare a focused prompt for continuing active work in this repo.',
      argsSchema: {
        goal: z.string().optional().describe('Optional goal or feature to focus on'),
        tool: z.string().optional().describe('Optional AI tool name for wording adjustments'),
        compact: z.string().optional().describe('Set to "true" for a shorter prompt body'),
      },
    },
    async ({ goal, tool, compact }) => {
      const snapshot = createProjectSnapshot(projectRoot, getSnapshotOptionsForPrompt('start', compact));
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: buildStartWorkPrompt(projectRoot, { goal, tool, compact: String(compact).toLowerCase() === 'true' }, snapshot),
          },
        }],
      };
    }
  );

  server.registerPrompt(
    'mindswap_resume_work',
    {
      title: 'Resume Work',
      description: 'Prepare a restart prompt that emphasizes blockers and the next best action.',
      argsSchema: {
        compact: z.string().optional().describe('Set to "true" for a shorter prompt body'),
      },
    },
    async ({ compact }) => {
      const snapshot = createProjectSnapshot(projectRoot, getSnapshotOptionsForPrompt('resume', compact));
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: buildResumeWorkPrompt(projectRoot, { compact: String(compact).toLowerCase() === 'true' }, snapshot),
          },
        }],
      };
    }
  );

  server.registerPrompt(
    'mindswap_prepare_handoff',
    {
      title: 'Prepare Handoff',
      description: 'Generate a handoff prompt that asks for the exact summary another agent needs.',
      argsSchema: {
        audience: z.string().optional().describe('Optional recipient or tool name'),
      },
    },
    async ({ audience }) => {
      const snapshot = createProjectSnapshot(projectRoot, getSnapshotOptionsForPrompt('handoff'));
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: buildHandoffPrompt(projectRoot, { audience }, snapshot),
          },
        }],
      };
    }
  );

  server.registerPrompt(
    'mindswap_review_conflicts',
    {
      title: 'Review Conflicts',
      description: 'Review decision and dependency conflicts before making changes.',
      argsSchema: {
        focus: z.string().optional().describe('Optional area to focus on, such as auth or database'),
      },
    },
    async ({ focus }) => {
      const snapshot = createProjectSnapshot(projectRoot, getSnapshotOptionsForPrompt('conflicts'));
      return {
        messages: [{
          role: 'user',
          content: {
            type: 'text',
            text: buildConflictReviewPrompt(projectRoot, { focus }, snapshot),
          },
        }],
      };
    }
  );

  return server;
}

async function startMCPServer() {
  const projectRoot = process.cwd();
  const server = createMCPServer(projectRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startMCPHttpServer(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const server = createMCPServer(projectRoot);

  const host = options.host || '127.0.0.1';
  const port = options.port ?? 3000;
  const pathName = normalizeHttpPath(options.path || '/mcp');
  const allowedOrigin = options.origin || '*';
  const token = options.token || null;
  const transports = new Map();

  const httpServer = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        applyCorsHeaders(res, allowedOrigin);
        res.writeHead(204);
        res.end();
        return;
      }

      if (normalizeHttpPath(req.url || '/') !== pathName) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32601, message: 'Not found.' },
          id: null,
        }));
        return;
      }

      if (token && !requestHasValidToken(req, token)) {
        applyCorsHeaders(res, allowedOrigin);
        res.writeHead(401, {
          'content-type': 'application/json',
          'www-authenticate': 'Bearer realm="mindswap"',
        });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Unauthorized.' },
          id: null,
        }));
        return;
      }

      applyCorsHeaders(res, allowedOrigin);
      const body = await readRequestBody(req);
      let parsedBody;
      if (body) {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Invalid JSON body.' },
            id: null,
          }));
          return;
        }
      }

      const sessionId = req.headers['mcp-session-id'];
      let transport = sessionId ? transports.get(String(sessionId)) : null;

      if (!transport) {
        const isInitialize = parsedBody && isInitializeRequest(parsedBody);
        if (!sessionId && isInitialize) {
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: newSessionId => {
              transports.set(String(newSessionId), transport);
            },
            onsessionclosed: closedSessionId => {
              transports.delete(String(closedSessionId));
            },
          });
          await server.connect(transport);
        } else if (!sessionId) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: no session ID provided.' },
            id: null,
          }));
          return;
        } else {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Unknown session.' },
            id: null,
          }));
          return;
        }
      }

      await transport.handleRequest(req, res, parsedBody);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: err.message || 'Internal server error' },
          id: null,
        }));
      }
    }
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, resolve);
  });

  const address = httpServer.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const localUrl = `http://${host}:${actualPort}${pathName}`;

  return {
    server: httpServer,
    url: localUrl,
    close: async () => {
      for (const transport of transports.values()) {
        await transport.close().catch(() => {});
      }
      await new Promise(resolve => httpServer.close(() => resolve()));
    },
  };
}

// ═══════════════════════════════════════════════════
// Tool implementations
// ═══════════════════════════════════════════════════

function getContext(projectRoot, focus, compact, snapshot = null) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    return {
      content: [{
        type: 'text',
        text: 'mindswap not initialized in this project. Run `npx mindswap init` first.',
      }],
    };
  }

  const currentSnapshot = snapshot || createProjectSnapshot(projectRoot, getSnapshotOptionsForContext(focus, compact));
  const state = currentSnapshot.state;
  const liveData = snapshotToLiveData(currentSnapshot, getLiveDataOptionsForContext(focus, compact));

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

    const memoryLines = formatMemorySection(currentSnapshot);
    if (memoryLines.length > 0) {
      sections.push(`## Structured Memory\n${memoryLines.join('\n')}`);
    }

    const guardrailSection = buildGuardrailSection(liveData.guardrails);
    if (guardrailSection) {
      sections.push(guardrailSection);
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

  if (liveData.nativeSessions?.length > 0) {
    const sessionSummary = getSessionSummary(liveData.nativeSessions);
    if (sessionSummary.trim()) {
      sections.push(sessionSummary.trim());
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

function searchContext(projectRoot, query, type, snapshot = null) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    return {
      content: [{ type: 'text', text: 'mindswap not initialized. Run `npx mindswap init` first.' }],
    };
  }

  const currentSnapshot = snapshot || createProjectSnapshot(projectRoot, { historyLimit: 50, recentCommitLimit: 5 });
  const queryTokens = tokenize(query);
  const results = [];
  const seen = new Set();

  // Search decisions
  if (type === 'all' || type === 'decisions') {
    for (const line of currentSnapshot.decisions) {
      addScoredResult(results, seen, {
        type: 'decision',
        content: line,
        source: 'decisions.log',
      }, queryTokens, 1.2);
    }
  }

  // Search history
  if (type === 'all' || type === 'history') {
    for (const entry of currentSnapshot.history) {
      addScoredResult(results, seen, {
        type: 'history',
        content: `[${entry.timestamp}] ${entry.message}${entry.ai_tool ? ` (${entry.ai_tool})` : ''}`,
        source: 'history',
      }, queryTokens, 1.0, JSON.stringify(entry));
    }
  }

  // Search current state
  if (type === 'all') {
    for (const item of listMemoryItemsFromSnapshot(currentSnapshot, { limit: 50 })) {
      addScoredResult(results, seen, {
        type: `memory:${item.type}`,
        content: `${item.type}: ${item.message} [${item.status}]`,
        source: 'memory',
      }, queryTokens, item.status === 'open' ? 1.15 : 1.0, `${item.type} ${item.tag} ${item.status} ${item.message}`);
    }

    const state = currentSnapshot.state;
    if (state.current_task?.description) {
      addScoredResult(results, seen, {
        type: 'task',
        content: `Current task: ${state.current_task.description} [${state.current_task.status}]`,
        source: 'state.current_task',
      }, queryTokens, 1.35, state.current_task.description);
    }
    if (state.project?.tech_stack?.length) {
      addScoredResult(results, seen, {
        type: 'project',
        content: `Tech stack includes: ${state.project.tech_stack.join(', ')}`,
        source: 'state.project',
      }, queryTokens, 0.9, state.project.tech_stack.join(' '));
    }
    if (state.current_task?.blocker) {
      addScoredResult(results, seen, {
        type: 'blocker',
        content: `Current blocker: ${state.current_task.blocker}`,
        source: 'state.current_task',
      }, queryTokens, 1.15, state.current_task.blocker);
    }
  }

  if (type === 'all') {
    for (const session of currentSnapshot.nativeSessions) {
      const combined = [
        session.summary || '',
        session.blockers?.join(' '),
        session.failures?.join(' '),
        session.fileEdits?.join(' '),
        session.toolCalls?.join(' '),
        session.messages?.map(message => message.text).join(' '),
      ].filter(Boolean).join(' ');
      addScoredResult(results, seen, {
        type: 'native-session',
        content: `${session.tool}${session.timestamp ? ` @ ${session.timestamp}` : ''}: ${session.summary || 'session context'}`,
        source: session.tool,
      }, queryTokens, 0.9, combined || session.rawText || session.tool);
    }

    for (const session of currentSnapshot.importedSessions) {
      const sourceLabel = session.tool || 'session';
      const combined = [...(session.decisions || []), ...(session.context || [])].join(' ');
      addScoredResult(results, seen, {
        type: 'imported',
        content: `${sourceLabel}: ${(session.context || session.decisions || []).slice(0, 3).join(' | ')}`,
        source: sourceLabel,
      }, queryTokens, 0.8, combined);
    }
  }

  if (results.length === 0) {
    return {
      content: [{
        type: 'text',
        text: `No results for "${query}". Try broader terms, or log more context with: npx mindswap log "your decision"`,
      }],
    };
  }

  const topResults = results
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
  const formatted = topResults.map(r => `[${r.type}] (${Math.round(r.score)}) ${r.content}`).join('\n');
  return {
    content: [{
      type: 'text',
      text: `Found ${results.length} result(s) for "${query}":\n\n${formatted}`,
    }],
  };
}

function renderContextText(projectRoot, focus = 'all', compact = false, snapshot = null) {
  const context = getContext(projectRoot, focus, compact, snapshot);
  return context?.content?.[0]?.text || '';
}

function readStableResource(projectRoot, kind, snapshot = null) {
  const currentSnapshot = snapshot || createProjectSnapshot(projectRoot, getSnapshotOptionsForResource(kind));
  const state = currentSnapshot.state;
  const liveData = snapshotToLiveData(currentSnapshot, getLiveDataOptionsForResource(kind));
  const memory = currentSnapshot.memory;
  const handoffPath = path.join(projectRoot, 'HANDOFF.md');
  const handoffText = fs.existsSync(handoffPath) ? fs.readFileSync(handoffPath, 'utf-8') : renderContextText(projectRoot, 'all', false, currentSnapshot);

  switch (kind) {
    case 'context':
      return buildTextResource('mindswap://context/current', renderContextText(projectRoot, 'all', false, currentSnapshot));
    case 'state':
      return buildJsonResource('mindswap://state/current', state);
    case 'decisions':
      return buildJsonResource('mindswap://decisions/recent', {
        decisions: liveData.decisions.slice(-20),
        conflicts: findAllConflicts(projectRoot),
        dependency_conflicts: checkDepsVsDecisions(projectRoot),
      });
    case 'memory':
      return buildJsonResource('mindswap://memory/current', memory);
    case 'handoff':
      return buildTextResource('mindswap://handoff/current', handoffText);
    default:
      throw new Error(`unknown resource kind: ${kind}`);
  }
}

function buildTextResource(uri, text) {
  return {
    contents: [{
      uri,
      mimeType: 'text/plain',
      text,
    }],
  };
}

function buildJsonResource(uri, value) {
  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(value, null, 2),
    }],
  };
}

function normalizeHttpPath(value) {
  let pathname = String(value || '/').split('?')[0] || '/';
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.replace(/\/+$/, '');
  return pathname || '/';
}

function applyCorsHeaders(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Session-Id, Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id, MCP-Protocol-Version');
}

function requestHasValidToken(req, token) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth) return false;
  const [scheme, value] = String(auth).split(/\s+/, 2);
  return /^bearer$/i.test(scheme) && value === token;
}

function isInitializeRequest(body) {
  return Boolean(body && body.method === 'initialize');
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'DELETE' || req.method === 'HEAD') {
      resolve('');
      return;
    }
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function buildStartWorkPrompt(projectRoot, { goal, tool, compact } = {}, snapshot = null) {
  const contextText = renderContextText(projectRoot, compact ? 'task' : 'all', Boolean(compact), snapshot);
  const lines = ['You are starting work in this repository.'];
  if (tool) lines.push(`Target tool: ${tool}.`);
  if (goal) lines.push(`Goal: ${goal}.`);
  lines.push('');
  lines.push('Use the context below, identify the next safe action, and call out blockers before suggesting implementation steps.');
  if (contextText) {
    lines.push('');
    lines.push(contextText);
  }
  return lines.join('\n');
}

function buildResumeWorkPrompt(projectRoot, { compact } = {}, snapshot = null) {
  const currentSnapshot = snapshot || createProjectSnapshot(projectRoot, getSnapshotOptionsForPrompt('resume', compact));
  const briefing = buildResumeBriefing(currentSnapshot.state, gatherResumeData(projectRoot, currentSnapshot), { compact });
  const lines = [
    'Resume this workstream from the current repo state.',
    '',
    briefing.summary,
    '',
    'State:',
    ...briefing.stateLines.map(line => `- ${line}`),
    '',
    'Recommendation:',
    `- ${briefing.recommendation.summary}`,
    ...briefing.recommendation.next_steps.map(step => `- ${step}`),
  ];

  if (briefing.recommendation.command) {
    lines.push(`- Next command: ${briefing.recommendation.command}`);
  }

  return lines.join('\n');
}

function buildHandoffPrompt(projectRoot, { audience } = {}, snapshot = null) {
  const contextText = renderContextText(projectRoot, 'all', false, snapshot);
  const lines = [
    audience ? `Prepare a handoff for ${audience}.` : 'Prepare a handoff for the next agent.',
    'Summarize what changed, what is still open, and what should happen next.',
    'Include files, commands, blockers, and any unresolved decisions.',
  ];
  if (contextText) {
    lines.push('');
    lines.push(contextText);
  }
  return lines.join('\n');
}

function buildConflictReviewPrompt(projectRoot, { focus } = {}, snapshot = null) {
  const contextText = renderContextText(projectRoot, 'decisions', false, snapshot);
  const lines = [
    focus ? `Review conflicts with a focus on ${focus}.` : 'Review the current decision and dependency conflicts.',
    'Identify contradictions, explain the impact, and propose the smallest safe resolution.',
  ];
  if (contextText) {
    lines.push('');
    lines.push(contextText);
  }
  return lines.join('\n');
}

function manageMemory(projectRoot, opts = {}) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    return {
      content: [{ type: 'text', text: 'mindswap not initialized. Run `npx mindswap init` first.' }],
    };
  }

  const action = String(opts.action || '').toLowerCase();
  const now = new Date().toISOString();

  let result = null;
  switch (action) {
    case 'list': {
      const items = listMemoryItems(projectRoot, {
        type: opts.type,
        status: opts.status,
        author: opts.author,
        source: opts.source,
        created_after: opts.after,
        created_before: opts.before,
        includeArchived: opts.status === 'archived' || opts.hard === true,
        limit: opts.limit || 20,
      });
      result = { action, count: items.length, items };
      break;
    }
    case 'get': {
      if (!opts.id) throw new Error('memory get requires an id');
      const item = getMemoryItemById(projectRoot, opts.id);
      result = item ? { action, item } : { action, item: null };
      break;
    }
    case 'add': {
      if (!opts.message) throw new Error('memory add requires a message');
      const item = appendMemoryItem(projectRoot, {
        type: opts.type || 'decision',
        tag: opts.tag || 'general',
        message: opts.message,
        status: opts.status || undefined,
        author: opts.author || null,
        source: opts.source || 'cli',
        created_at: now,
      });
      result = { action, item };
      break;
    }
    case 'update': {
      if (!opts.id) throw new Error('memory update requires an id');
      const item = updateMemoryItem(projectRoot, opts.id, {
        type: opts.type,
        tag: opts.tag,
        message: opts.message,
        status: opts.status,
        author: opts.author,
        source: opts.source,
        updated_at: now,
      });
      if (!item) throw new Error(`memory item not found: ${opts.id}`);
      result = { action, item };
      break;
    }
    case 'resolve': {
      if (!opts.id) throw new Error('memory resolve requires an id');
      const item = resolveMemoryItem(projectRoot, opts.id, {
        message: opts.message,
        tag: opts.tag,
        author: opts.author,
        source: opts.source,
        resolved_at: now,
      });
      if (!item) throw new Error(`memory item not found: ${opts.id}`);
      result = { action, item };
      break;
    }
    case 'archive': {
      if (!opts.id) throw new Error('memory archive requires an id');
      const item = archiveMemoryItem(projectRoot, opts.id, {
        message: opts.message,
        tag: opts.tag,
        author: opts.author,
        source: opts.source,
        archived_at: now,
      });
      if (!item) throw new Error(`memory item not found: ${opts.id}`);
      result = { action, item };
      break;
    }
    case 'delete': {
      if (!opts.id) throw new Error('memory delete requires an id');
      const item = deleteMemoryItem(projectRoot, opts.id, { hard: Boolean(opts.hard), archived_at: now });
      if (!item) throw new Error(`memory item not found: ${opts.id}`);
      result = { action, item, deleted: Boolean(opts.hard) };
      break;
    }
    default:
      throw new Error(`unknown memory action: ${opts.action}`);
  }

  const text = opts.json
    ? JSON.stringify(result, null, 2)
    : formatMemoryResult(result);

  return {
    content: [{ type: 'text', text }],
  };
}

// ═══════════════════════════════════════════════════
// Helper — gather live project data
// ═══════════════════════════════════════════════════

function gatherLiveData(projectRoot) {
  return snapshotToLiveData(createProjectSnapshot(projectRoot, getSnapshotOptionsForContext('all', false)), getLiveDataOptionsForContext('all', false));
}

function snapshotToLiveData(snapshot, opts = {}) {
  return {
    branch: snapshot.branch,
    changedFiles: snapshot.changedFiles,
    recentCommits: snapshot.recentCommits,
    decisions: snapshot.decisions,
    history: snapshot.history,
    nativeSessions: opts.includeNativeSessions === false ? [] : snapshot.nativeSessions,
    structuredMemory: snapshot.memory?.items || [],
    importedSessions: opts.includeImportedSessions === false ? [] : snapshot.importedSessions,
    guardrails: opts.includeGuardrails === false ? null : snapshot.guardrails,
  };
}

function tokenize(query) {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(token => token.length > 1);

  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const alias of QUERY_ALIASES[token] || []) {
      expanded.add(alias);
    }
  }

  return [...expanded];
}

function addScoredResult(results, seen, entry, queryTokens, weight, haystackText = '') {
  const text = haystackText || entry.content || '';
  const score = scoreText(text, queryTokens, weight);
  if (score <= 0) return;
  const key = `${entry.type}::${entry.content}`;
  if (seen.has(key)) return;
  seen.add(key);
  results.push({ ...entry, score });
}

function scoreText(text, queryTokens, weight = 1) {
  if (!text || queryTokens.length === 0) return 0;
  const haystack = String(text).toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += token.length >= 5 ? 4 : 2;
    } else {
      const fuzzy = findLooseMatch(token, haystack);
      if (fuzzy) score += 1;
    }
  }
  const coverage = score / Math.max(queryTokens.length * 4, 1);
  return score * weight * (0.75 + coverage);
}

function findLooseMatch(token, haystack) {
  if (token.length < 4) return false;
  const variants = [
    token.replace(/s$/, ''),
    token.replace(/ing$/, ''),
    token.replace(/ed$/, ''),
    token.replace(/tion$/, 't'),
  ].filter(Boolean);
  return variants.some(v => v !== token && v.length >= 3 && haystack.includes(v));
}

function getSnapshotOptionsForContext(focus, compact) {
  const base = { historyLimit: 20, recentCommitLimit: 5 };
  if (compact || focus === 'task') {
    return {
      ...base,
      includeNativeSessions: false,
      includeImportedSessions: false,
      includeGuardrails: false,
    };
  }
  if (focus === 'recent') {
    return {
      ...base,
      includeNativeSessions: true,
      includeImportedSessions: false,
      includeGuardrails: false,
    };
  }
  if (focus === 'decisions') {
    return {
      ...base,
      includeNativeSessions: false,
      includeImportedSessions: false,
      includeGuardrails: true,
    };
  }
  return {
    ...base,
    includeNativeSessions: true,
    includeImportedSessions: true,
    includeGuardrails: true,
  };
}

function getLiveDataOptionsForContext(focus, compact) {
  if (compact || focus === 'task') {
    return {
      includeNativeSessions: false,
      includeImportedSessions: false,
      includeGuardrails: false,
    };
  }
  if (focus === 'recent') {
    return {
      includeNativeSessions: true,
      includeImportedSessions: false,
      includeGuardrails: false,
    };
  }
  if (focus === 'decisions') {
    return {
      includeNativeSessions: false,
      includeImportedSessions: false,
      includeGuardrails: true,
    };
  }
  return {
    includeNativeSessions: true,
    includeImportedSessions: true,
    includeGuardrails: true,
  };
}

function getSnapshotOptionsForSearch(type) {
  const base = { historyLimit: 50, recentCommitLimit: 5 };
  if (type === 'decisions' || type === 'history') {
    return {
      ...base,
      includeNativeSessions: false,
      includeImportedSessions: false,
      includeGuardrails: false,
    };
  }
  return {
    ...base,
    includeNativeSessions: true,
    includeImportedSessions: true,
    includeGuardrails: false,
  };
}

function getSnapshotOptionsForResource(kind) {
  const base = { historyLimit: 20, recentCommitLimit: 5 };
  switch (kind) {
    case 'context':
    case 'handoff':
      return {
        ...base,
        includeNativeSessions: true,
        includeImportedSessions: true,
        includeGuardrails: true,
      };
    case 'decisions':
      return {
        ...base,
        includeNativeSessions: false,
        includeImportedSessions: false,
        includeGuardrails: false,
      };
    case 'state':
    case 'memory':
    default:
      return {
        ...base,
        includeNativeSessions: false,
        includeImportedSessions: false,
        includeGuardrails: false,
      };
  }
}

function getLiveDataOptionsForResource(kind) {
  switch (kind) {
    case 'context':
    case 'handoff':
      return {
        includeNativeSessions: true,
        includeImportedSessions: true,
        includeGuardrails: true,
      };
    default:
      return {
        includeNativeSessions: false,
        includeImportedSessions: false,
        includeGuardrails: false,
      };
  }
}

function getSnapshotOptionsForPrompt(kind, compact) {
  if (kind === 'conflicts') {
    return {
      historyLimit: 20,
      recentCommitLimit: 5,
      includeNativeSessions: false,
      includeImportedSessions: false,
      includeGuardrails: true,
    };
  }
  if (kind === 'resume') {
    return {
      historyLimit: 20,
      recentCommitLimit: 5,
      includeNativeSessions: true,
      includeImportedSessions: true,
      includeGuardrails: true,
    };
  }
  if (kind === 'start') {
    return getSnapshotOptionsForContext('all', String(compact).toLowerCase() === 'true');
  }
  return {
    historyLimit: 20,
    recentCommitLimit: 5,
    includeNativeSessions: true,
    includeImportedSessions: true,
    includeGuardrails: true,
  };
}

const QUERY_ALIASES = {
  auth: ['authentication', 'login', 'session', 'jwt', 'token'],
  authentication: ['auth', 'login', 'session', 'jwt', 'token'],
  database: ['db', 'postgres', 'postgresql', 'mysql', 'sqlite', 'prisma', 'drizzle'],
  db: ['database', 'postgres', 'postgresql', 'mysql', 'sqlite', 'prisma', 'drizzle'],
  session: ['auth', 'login', 'jwt', 'token'],
  sessions: ['auth', 'login', 'jwt', 'token'],
  login: ['auth', 'authentication', 'session', 'jwt', 'token'],
  api: ['route', 'endpoint', 'handler', 'controller'],
  testing: ['test', 'tests', 'spec', 'jest', 'vitest', 'pytest'],
  test: ['testing', 'tests', 'spec', 'jest', 'vitest', 'pytest'],
  deployment: ['deploy', 'release', 'ci', 'cd', 'workflow'],
  deploy: ['deployment', 'release', 'ci', 'cd', 'workflow'],
  billing: ['payment', 'invoice', 'stripe', 'subscription'],
  payment: ['billing', 'invoice', 'stripe', 'subscription'],
  config: ['configuration', 'settings', 'env'],
  ui: ['frontend', 'component', 'page', 'view'],
};

function formatMemorySection(snapshot) {
  const lines = [];
  for (const item of getSnapshotMemoryItems(snapshot, { type: 'blocker', status: 'open', limit: 5 })) lines.push(`- BLOCKER: ${item.message}`);
  for (const item of getSnapshotMemoryItems(snapshot, { type: 'question', status: 'open', limit: 5 })) lines.push(`- QUESTION: ${item.message}`);
  for (const item of getSnapshotMemoryItems(snapshot, { type: 'assumption', status: 'open', limit: 5 })) lines.push(`- ASSUMPTION: ${item.message}`);
  for (const item of getSnapshotMemoryItems(snapshot, { type: 'resolution', limit: 10 }).slice(-5)) {
    lines.push(`- RESOLUTION: ${item.message}`);
  }
  return lines;
}

function getSnapshotMemoryItems(snapshot, opts = {}) {
  const items = Array.isArray(snapshot.memory?.items) ? snapshot.memory.items.slice() : [];
  let filtered = items;
  if (opts.type) {
    const types = Array.isArray(opts.type) ? opts.type : [opts.type];
    filtered = filtered.filter(item => types.includes(item.type));
  }
  if (opts.status) {
    filtered = filtered.filter(item => item.status === opts.status);
  }
  if (opts.source) {
    const sources = Array.isArray(opts.source) ? opts.source : [opts.source];
    filtered = filtered.filter(item => sources.includes(item.source));
  }
  if (opts.author) {
    const authors = Array.isArray(opts.author) ? opts.author : [opts.author];
    filtered = filtered.filter(item => authors.includes(item.author));
  }
  if (opts.limit) {
    const limit = Number(opts.limit);
    if (Number.isFinite(limit) && limit > 0) {
      filtered = filtered.slice(-limit);
    }
  }
  return filtered;
}

function listMemoryItemsFromSnapshot(snapshot, opts = {}) {
  return getSnapshotMemoryItems(snapshot, {
    ...opts,
    includeArchived: opts.includeArchived || opts.status === 'archived',
  });
}

function formatMemoryResult(result) {
  if (!result) return 'No memory result.';
  if (result.action === 'list') {
    const lines = [`Memory items: ${result.count}`];
    for (const item of result.items || []) {
      lines.push(`- [${item.type}/${item.status}] ${item.id}: ${item.message}`);
    }
    return lines.join('\n');
  }
  if (result.item) {
    const item = result.item;
    return [
      `${result.action.toUpperCase()} memory item`,
      `- id: ${item.id}`,
      `- type: ${item.type}`,
      `- status: ${item.status}`,
      `- tag: ${item.tag}`,
      `- message: ${item.message}`,
      item.source ? `- source: ${item.source}` : null,
      item.author ? `- author: ${item.author}` : null,
    ].filter(Boolean).join('\n');
  }
  return `${result.action} complete.`;
}

module.exports = {
  createMCPServer,
  startMCPServer,
  startMCPHttpServer,
  manageMemory,
  searchContext,
  tokenize,
  scoreText,
  formatMemorySection,
  readStableResource,
  buildStartWorkPrompt,
  buildResumeWorkPrompt,
  buildHandoffPrompt,
  buildConflictReviewPrompt,
};
