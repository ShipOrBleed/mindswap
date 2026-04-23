const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_FILES = 20;
const MAX_COMMANDS = 10;
const MAX_MESSAGES = 8;
const MAX_SESSION_FILES = 8;

/**
 * Parse native AI tool sessions into a normalized model.
 * Returns the most relevant recent sessions for the current project.
 */
function parseNativeSessions(projectRoot) {
  const sessions = [];

  sessions.push(...parseClaudeCodeSessions(projectRoot));
  sessions.push(...parseCodexSessions(projectRoot));

  return sessions
    .filter(session => session && session.projectMatch?.score > 0)
    .sort((a, b) => {
      const scoreDiff = (b.projectMatch?.score || 0) - (a.projectMatch?.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (b.timestamp || '').localeCompare(a.timestamp || '');
    })
    .slice(0, 4);
}

/**
 * Parse Claude Code session data from ~/.claude/projects/.
 */
function parseClaudeCodeSessions(projectRoot) {
  const claudeBase = path.join(os.homedir(), '.claude');
  const projectsDir = path.join(claudeBase, 'projects');
  if (!fs.existsSync(projectsDir)) return [];

  const sessions = [];
  for (const projectDirName of safeReaddir(projectsDir)) {
    const projectDir = path.join(projectsDir, projectDirName);
    if (!isDirectory(projectDir)) continue;

    const sessionFiles = safeReaddir(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .sort((a, b) => fileMtime(path.join(projectDir, b)) - fileMtime(path.join(projectDir, a)))
      .slice(0, MAX_SESSION_FILES);

    for (const sessionFile of sessionFiles) {
      const sourceFile = path.join(projectDir, sessionFile);
      const parsed = parseClaudeSessionFile(projectRoot, sourceFile, projectDirName);
      if (parsed) sessions.push(parsed);
    }
  }

  return sessions;
}

function parseClaudeSessionFile(projectRoot, sourceFile, projectDirName) {
  const content = readText(sourceFile);
  if (!content) return null;

  const entries = content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-5000)
    .map(line => safeJsonParse(line))
    .filter(Boolean);

  if (entries.length === 0) return null;
  return normalizeSession({
    tool: 'Claude Code',
    sourceFile,
    projectRoot,
    sourceLabel: projectDirName,
    entries,
    rawText: content,
    modifiedAt: fileMtime(sourceFile),
  });
}

/**
 * Parse OpenAI Codex CLI sessions from ~/.codex/sessions/.
 */
function parseCodexSessions(projectRoot) {
  const codexDir = path.join(os.homedir(), '.codex', 'sessions');
  if (!fs.existsSync(codexDir)) return [];

  const sessions = [];
  const sessionFiles = safeReaddir(codexDir)
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => fileMtime(path.join(codexDir, b)) - fileMtime(path.join(codexDir, a)))
    .slice(0, MAX_SESSION_FILES);

  for (const sessionFile of sessionFiles) {
    const sourceFile = path.join(codexDir, sessionFile);
    const content = readText(sourceFile);
    if (!content) continue;

    const session = safeJsonParse(content);
    if (!session) continue;

    const entries = [];
    if (Array.isArray(session.messages)) {
      for (const message of session.messages) {
        entries.push(message);
      }
    }
    if (Array.isArray(session.events)) {
      for (const event of session.events) {
        entries.push(event);
      }
    }
    if (Array.isArray(session.transcript)) {
      for (const item of session.transcript) {
        entries.push(item);
      }
    }
    if (entries.length === 0) {
      entries.push(session);
    }

    const normalized = normalizeSession({
      tool: 'Codex',
      sourceFile,
      projectRoot,
      sourceLabel: sessionFile,
      entries,
      rawText: content,
      modifiedAt: fileMtime(sourceFile),
    });

    if (normalized) sessions.push(normalized);
  }

  return sessions;
}

/**
 * Normalize a raw session file into a structured record.
 */
function normalizeSession({ tool, sourceFile, projectRoot, sourceLabel, entries, rawText, modifiedAt }) {
  const messages = [];
  const fileEdits = [];
  const toolCalls = [];
  const blockers = [];
  const failures = [];
  const snippets = [];
  let timestamp = null;

  for (const entry of entries) {
    if (!entry) continue;

    if (typeof entry === 'string') {
      const text = entry.trim();
      if (text) {
        messages.push({ role: 'unknown', text });
        snippets.push(text);
        if (looksBlocked(text)) blockers.push(firstSentence(text));
        if (looksFailed(text)) failures.push(firstSentence(text));
      }
      continue;
    }

    if (typeof entry !== 'object') continue;

    const entryTime = extractTimestamp(entry);
    if (entryTime && (!timestamp || entryTime > timestamp)) timestamp = entryTime;

    const entryText = extractEntryText(entry);
    if (entryText) snippets.push(entryText);

    const messageText = extractMessageText(entry);
    if (messageText) {
      const role = typeof entry.role === 'string'
        ? entry.role
        : typeof entry.type === 'string'
          ? entry.type
          : 'unknown';
      messages.push({ role, text: messageText });
      if (looksBlocked(messageText)) blockers.push(firstSentence(messageText));
      if (looksFailed(messageText)) failures.push(firstSentence(messageText));
    }

    const extractedFiles = extractFileEdits(entry);
    for (const file of extractedFiles) {
      fileEdits.push(file);
      snippets.push(file);
    }

    const extractedCommands = extractToolCalls(entry);
    for (const cmd of extractedCommands) {
      toolCalls.push(cmd);
      snippets.push(cmd);
    }
  }

  if (!timestamp) timestamp = modifiedAt || null;

  const uniqueFiles = uniqueStrings(fileEdits).slice(0, MAX_FILES);
  const uniqueCommands = uniqueStrings(toolCalls).slice(0, MAX_COMMANDS);
  const uniqueMessages = dedupeMessages(messages).slice(-MAX_MESSAGES);
  const uniqueBlockers = uniqueStrings(blockers).slice(0, 5);
  const uniqueFailures = uniqueStrings(failures).slice(0, 5);

  const score = scoreProjectMatch({
    projectRoot,
    sourceFile,
    sourceLabel,
    rawText,
    snippets,
    fileEdits: uniqueFiles,
    toolCalls: uniqueCommands,
    messages: uniqueMessages,
  });

  if (score.score <= 0 && uniqueFiles.length === 0 && uniqueCommands.length === 0 && uniqueMessages.length === 0) {
    return null;
  }

  return {
    tool,
    sourceFile,
    sourceLabel,
    timestamp,
    projectMatch: score,
    status: uniqueBlockers.length > 0 || uniqueFailures.length > 0 ? 'blocked' : 'active',
    summary: buildSessionSummary(uniqueMessages, uniqueFiles, uniqueCommands, uniqueBlockers, uniqueFailures),
    fileEdits: uniqueFiles,
    toolCalls: uniqueCommands,
    messages: uniqueMessages,
    blockers: uniqueBlockers,
    failures: uniqueFailures,
  };
}

function buildSessionSummary(messages, fileEdits, toolCalls, blockers, failures) {
  const opener = messages.find(m => m.role === 'assistant' && m.text)?.text
    || messages.find(m => m.text)?.text
    || '';
  if (opener) {
    const trimmed = firstSentence(opener);
    if (trimmed) return trimmed;
  }

  if (blockers.length > 0) {
    return `Blocked: ${blockers[0]}`;
  }

  if (failures.length > 0) {
    return `Failed: ${failures[0]}`;
  }

  if (fileEdits.length > 0) {
    const sample = fileEdits.slice(0, 3).map(f => `\`${path.basename(f)}\``).join(', ');
    return `Edited ${sample}`;
  }

  if (toolCalls.length > 0) {
    const sample = toolCalls.slice(0, 2).map(c => `\`${c.slice(0, 40)}\``).join(', ');
    return `Ran ${sample}`;
  }

  return '';
}

function scoreProjectMatch({ projectRoot, sourceFile, sourceLabel, rawText, snippets, fileEdits, toolCalls, messages }) {
  const projectName = path.basename(projectRoot).toLowerCase();
  const normalizedRoot = normalizePath(projectRoot);

  let score = 0;
  const signals = [];
  const haystacks = [
    normalizePath(rawText),
    normalizePath(sourceFile),
    normalizePath(sourceLabel),
    ...snippets.map(normalizePath),
    ...fileEdits.map(normalizePath),
    ...toolCalls.map(normalizePath),
    ...messages.map(m => normalizePath(m.text || '')),
  ].filter(Boolean);

  if (normalizePath(sourceFile).includes(normalizedRoot)) {
    score += 40;
    signals.push('path match');
  }

  if (normalizePath(sourceLabel).includes(projectName)) {
    score += 20;
    signals.push('project dir match');
  }

  if (haystacks.some(text => text.includes(normalizedRoot))) {
    score += 45;
    signals.push('project path mentioned');
  }

  if (haystacks.some(text => text.includes(projectName))) {
    score += 15;
    signals.push('project name mentioned');
  }

  const projectFiles = fileEdits.filter(file => isProjectPath(file, projectRoot));
  if (projectFiles.length > 0) {
    score += Math.min(30, projectFiles.length * 10);
    signals.push(`${projectFiles.length} file(s) in project`);
  }

  const commandHits = toolCalls.filter(cmd => isProjectPath(cmd, projectRoot));
  if (commandHits.length > 0) {
    score += Math.min(20, commandHits.length * 5);
    signals.push(`${commandHits.length} command(s) in project`);
  }

  return {
    score,
    matched: score > 0,
    signals: uniqueStrings(signals).slice(0, 8),
  };
}

function extractTimestamp(entry) {
  const candidates = [
    entry.timestamp,
    entry.created_at,
    entry.createdAt,
    entry.time,
    entry.ts,
    entry.date,
    entry.updated_at,
    entry.updatedAt,
  ];
  for (const candidate of candidates) {
    const parsed = parseDate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function extractEntryText(entry) {
  const parts = [];

  const push = value => {
    if (typeof value === 'string' && value.trim()) parts.push(value.trim());
  };

  push(entry.text);
  push(entry.message);
  push(entry.content);
  push(entry.command);
  push(entry.output);
  push(entry.result);
  push(entry.summary);

  if (Array.isArray(entry.content)) {
    for (const block of entry.content) {
      if (!block || typeof block !== 'object') continue;
      push(block.text);
      push(block.content);
      push(block.command);
      push(block.input?.command);
      push(block.input?.text);
      push(block.input?.file_path);
      push(block.input?.path);
      push(block.input?.new_string);
      push(block.input?.old_string);
      push(block.input?.files);
    }
  }

  if (Array.isArray(entry.messages)) {
    for (const message of entry.messages) {
      push(extractMessageText(message));
    }
  }

  return uniqueStrings(parts).join(' ');
}

function extractMessageText(entry) {
  if (!entry || typeof entry !== 'object') return '';

  if (typeof entry.content === 'string') return entry.content.trim();
  if (Array.isArray(entry.content)) {
    const textParts = [];
    for (const block of entry.content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text.trim());
      } else if (block.type === 'tool_use') {
        continue;
      } else if (typeof block.text === 'string') {
        textParts.push(block.text.trim());
      }
    }
    return textParts.join(' ').trim();
  }

  if (typeof entry.message === 'string') return entry.message.trim();
  if (typeof entry.text === 'string') return entry.text.trim();
  if (typeof entry.output === 'string') return entry.output.trim();
  if (typeof entry.summary === 'string') return entry.summary.trim();
  return '';
}

function extractFileEdits(entry) {
  const edits = [];

  const scanInput = input => {
    if (!input || typeof input !== 'object') return;
    const paths = [
      input.file_path,
      input.path,
      input.file,
      input.filename,
      input.target_file,
      input.targetFile,
      input.files,
      input.paths,
    ];
    for (const value of paths) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string') edits.push(item.trim());
        }
      } else if (typeof value === 'string') {
        edits.push(value.trim());
      }
    }
  };

  if (Array.isArray(entry.content)) {
    for (const block of entry.content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'tool_use' || block.type === 'tool') {
        if (['Edit', 'Write', 'MultiEdit', 'Replace', 'Patch'].includes(block.name)) {
          scanInput(block.input);
        }
      }
    }
  }

  scanInput(entry);
  return uniqueStrings(edits);
}

function extractToolCalls(entry) {
  const commands = [];

  const pushCommand = value => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed.length > 240) {
      commands.push(trimmed.slice(0, 240));
    } else {
      commands.push(trimmed);
    }
  };

  if (Array.isArray(entry.content)) {
    for (const block of entry.content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'tool_use' || block.type === 'tool') {
        if (block.name === 'Bash' || block.name === 'Shell' || block.name === 'Terminal') {
          pushCommand(block.input?.command || block.input?.text || block.text);
        }
      }
    }
  }

  pushCommand(entry.command);
  pushCommand(entry.input?.command);
  pushCommand(entry.input?.text);
  pushCommand(entry.shell);

  return uniqueStrings(commands);
}

function looksBlocked(text) {
  return /\b(blocked|blocker|stuck|waiting on|can't continue|cannot continue|need .* before|hold up)\b/i.test(text);
}

function looksFailed(text) {
  return /\b(fail|failed|error|exception|traceback|crash|broken|cannot run)\b/i.test(text);
}

function firstSentence(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/[.!?\n]/)[0]
    .trim();
}

function normalizePath(value) {
  return String(value || '').toLowerCase().replace(/\\/g, '/');
}

function isProjectPath(value, projectRoot) {
  const normalized = normalizePath(value);
  const root = normalizePath(projectRoot);
  const base = path.basename(projectRoot).toLowerCase();
  return normalized.includes(root) || normalized.includes(`/${base}/`) || normalized.endsWith(`/${base}`);
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function fileMtime(filePath) {
  try {
    return new Date(fs.statSync(filePath).mtimeMs).toISOString();
  } catch {
    return null;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function safeJsonParse(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function dedupeMessages(messages) {
  const seen = new Set();
  const result = [];
  for (const message of messages || []) {
    if (!message || !message.text) continue;
    const key = `${message.role || 'unknown'}::${message.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ role: message.role || 'unknown', text: message.text });
  }
  return result;
}

/**
 * Get a summary of native session data for HANDOFF.md and MCP context.
 */
function getSessionSummary(sessions) {
  if (!sessions || sessions.length === 0) return '';

  const lines = [];
  lines.push('\n## Recent AI sessions\n');

  for (const session of sessions) {
    const relevance = session.projectMatch?.score != null ? `${session.projectMatch.score}/100` : 'n/a';
    const timestamp = session.timestamp ? ` @ ${session.timestamp}` : '';
    lines.push(`### ${session.tool}${timestamp}`);
    lines.push(`Relevance: ${relevance}`);

    if (session.summary) {
      lines.push(`Summary: ${session.summary}`);
    }

    if (session.fileEdits?.length > 0) {
      lines.push(`Files edited: ${session.fileEdits.slice(0, 10).map(f => `\`${path.basename(f)}\``).join(', ')}`);
    }

    if (session.toolCalls?.length > 0) {
      lines.push(`Commands run: ${session.toolCalls.slice(0, 5).map(c => `\`${c.slice(0, 60)}\``).join(', ')}`);
    }

    if (session.blockers?.length > 0) {
      lines.push(`Blocker: ${session.blockers[0]}`);
    }

    if (session.failures?.length > 0) {
      lines.push(`Failure: ${session.failures[0]}`);
    }

    if (session.messages?.length > 0) {
      lines.push('Last actions:');
      for (const message of session.messages.slice(-3)) {
        const first = firstSentence(message.text);
        if (first.length > 10) {
          lines.push(`- ${first}`);
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = {
  parseNativeSessions,
  getSessionSummary,
  parseClaudeCodeSessions,
  parseCodexSessions,
  normalizeSession,
};
