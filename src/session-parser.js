const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Parse native AI tool session files for rich context.
 * Reads actual conversation/session data from tool-specific formats.
 */
function parseNativeSessions(projectRoot) {
  const sessions = [];

  const claude = parseClaudeCodeSessions(projectRoot);
  if (claude) sessions.push(claude);

  const codex = parseCodexSessions(projectRoot);
  if (codex) sessions.push(codex);

  return sessions;
}

/**
 * Parse Claude Code session data.
 * Claude Code stores sessions in ~/.claude/projects/<hash>/
 * Each session is a JSONL file with messages.
 */
function parseClaudeCodeSessions(projectRoot) {
  const claudeBase = path.join(os.homedir(), '.claude');
  if (!fs.existsSync(claudeBase)) return null;

  const projectsDir = path.join(claudeBase, 'projects');
  if (!fs.existsSync(projectsDir)) return null;

  // Find the project directory matching our project root
  // Claude uses sanitized paths as directory names
  const sanitizedRoot = projectRoot.replace(/\//g, '-').replace(/^-/, '');
  const projectDirs = safeReaddir(projectsDir);

  let sessionDir = null;
  for (const dir of projectDirs) {
    if (dir.includes(sanitizedRoot) || dir.includes(path.basename(projectRoot))) {
      sessionDir = path.join(projectsDir, dir);
      break;
    }
  }

  if (!sessionDir) return null;

  const result = {
    tool: 'Claude Code',
    lastSession: null,
    fileEdits: [],
    toolCalls: [],
    messages: [],
    summary: null,
  };

  // Read session JSONL files
  const sessionFiles = safeReaddir(sessionDir)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .reverse(); // Most recent first

  if (sessionFiles.length === 0) return null;

  // Parse the most recent session
  const latestSession = path.join(sessionDir, sessionFiles[0]);
  try {
    const content = fs.readFileSync(latestSession, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim()).slice(-5000); // Limit to last 5000 lines

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Extract assistant messages (summarize what was done)
        if (entry.role === 'assistant' && entry.content) {
          const text = typeof entry.content === 'string' ? entry.content :
            Array.isArray(entry.content) ? entry.content.filter(c => c.type === 'text').map(c => c.text).join(' ') : '';
          if (text.length > 20 && text.length < 500) {
            result.messages.push(text.slice(0, 300));
          }
        }

        // Extract tool use (file edits, commands run)
        if (entry.role === 'assistant' && Array.isArray(entry.content)) {
          for (const block of entry.content) {
            if (block.type === 'tool_use') {
              if (block.name === 'Edit' || block.name === 'Write') {
                result.fileEdits.push(block.input?.file_path || 'unknown file');
              }
              if (block.name === 'Bash') {
                const cmd = (block.input?.command || '').slice(0, 100);
                if (cmd && !cmd.includes('password') && !cmd.includes('secret')) {
                  result.toolCalls.push(cmd);
                }
              }
            }
          }
        }
      } catch {}
    }

    // Deduplicate
    result.fileEdits = [...new Set(result.fileEdits)].slice(0, 20);
    result.toolCalls = [...new Set(result.toolCalls)].slice(0, 10);
    result.messages = result.messages.slice(-5);
    result.lastSession = sessionFiles[0];

  } catch {}

  return result.fileEdits.length > 0 || result.messages.length > 0 ? result : null;
}

/**
 * Parse OpenAI Codex CLI session data.
 * Codex stores sessions in ~/.codex/sessions/ as JSON files.
 */
function parseCodexSessions(projectRoot) {
  const codexDir = path.join(os.homedir(), '.codex', 'sessions');
  if (!fs.existsSync(codexDir)) return null;

  const result = {
    tool: 'Codex',
    lastSession: null,
    fileEdits: [],
    toolCalls: [],
    messages: [],
  };

  const sessionFiles = safeReaddir(codexDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  if (sessionFiles.length === 0) return null;

  // Parse most recent session
  try {
    const content = fs.readFileSync(path.join(codexDir, sessionFiles[0]), 'utf-8');
    const session = JSON.parse(content);

    if (Array.isArray(session.messages)) {
      for (const msg of session.messages) {
        if (msg.role === 'assistant' && typeof msg.content === 'string') {
          if (msg.content.length > 20 && msg.content.length < 500) {
            result.messages.push(msg.content.slice(0, 300));
          }
        }
      }
    }

    result.lastSession = sessionFiles[0];
    result.messages = result.messages.slice(-5);
  } catch {}

  return result.messages.length > 0 ? result : null;
}

/**
 * Get a summary of native session data for HANDOFF.md.
 */
function getSessionSummary(sessions) {
  if (sessions.length === 0) return '';

  const lines = [];
  lines.push('\n## Recent AI sessions\n');

  for (const session of sessions) {
    lines.push(`### ${session.tool}`);

    if (session.fileEdits?.length > 0) {
      lines.push(`Files edited: ${session.fileEdits.slice(0, 10).map(f => `\`${path.basename(f)}\``).join(', ')}`);
    }

    if (session.toolCalls?.length > 0) {
      lines.push(`Commands run: ${session.toolCalls.slice(0, 5).map(c => `\`${c.slice(0, 60)}\``).join(', ')}`);
    }

    if (session.messages?.length > 0) {
      lines.push(`Last actions:`);
      for (const msg of session.messages.slice(-3)) {
        // Extract first sentence
        const firstSentence = msg.split(/[.!?\n]/)[0].trim();
        if (firstSentence.length > 10) {
          lines.push(`- ${firstSentence}`);
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

module.exports = { parseNativeSessions, getSessionSummary, parseClaudeCodeSessions };
