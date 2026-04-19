const fs = require('fs');
const path = require('path');

/**
 * Import context from AI tool session directories.
 * Reads actual session data from .claude/, .cursor/, etc.
 * Returns { tool, sessions, decisions, context }
 */
function importSessions(projectRoot) {
  const results = [];

  // Claude Code sessions
  const claudeData = importClaudeSessions(projectRoot);
  if (claudeData) results.push(claudeData);

  // Cursor sessions
  const cursorData = importCursorData(projectRoot);
  if (cursorData) results.push(cursorData);

  // Aider sessions
  const aiderData = importAiderData(projectRoot);
  if (aiderData) results.push(aiderData);

  return results;
}

/**
 * Import from Claude Code's .claude/ directory.
 * Claude stores project settings and CLAUDE.md references.
 */
function importClaudeSessions(projectRoot) {
  const claudeDir = path.join(projectRoot, '.claude');
  if (!fs.existsSync(claudeDir)) return null;

  const result = { tool: 'Claude Code', decisions: [], context: [] };

  // Read CLAUDE.md for project conventions
  const claudeMd = path.join(projectRoot, 'CLAUDE.md');
  if (fs.existsSync(claudeMd)) {
    try {
      const content = fs.readFileSync(claudeMd, 'utf-8');
      const extracted = extractContextFromMarkdown(content, 'Claude Code');
      result.decisions.push(...extracted.decisions);
      result.context.push(...extracted.context);
    } catch {}
  }

  // Read .claude/settings.json for project config
  const settingsPath = path.join(claudeDir, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (settings.allowedCommands?.length) {
        result.context.push(`Claude Code allowed commands: ${settings.allowedCommands.join(', ')}`);
      }
    } catch {}
  }

  // Read .claude/projects/ for project-specific memory
  const projectsDir = path.join(claudeDir, 'projects');
  if (fs.existsSync(projectsDir)) {
    try {
      const dirs = fs.readdirSync(projectsDir).filter(d =>
        fs.statSync(path.join(projectsDir, d)).isDirectory()
      );
      for (const dir of dirs) {
        // Check for CLAUDE.md within project dirs
        const projClaude = path.join(projectsDir, dir, 'CLAUDE.md');
        if (fs.existsSync(projClaude)) {
          try {
            const content = fs.readFileSync(projClaude, 'utf-8');
            const extracted = extractContextFromMarkdown(content, 'Claude Code (project)');
            result.decisions.push(...extracted.decisions);
            result.context.push(...extracted.context);
          } catch {}
        }

        // Check for memory files
        const memoryDir = path.join(projectsDir, dir, 'memory');
        if (fs.existsSync(memoryDir)) {
          try {
            const memFiles = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md'));
            for (const mf of memFiles.slice(0, 10)) {
              try {
                const content = fs.readFileSync(path.join(memoryDir, mf), 'utf-8');
                // Extract the key info from memory files (usually short)
                const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('---') && !l.startsWith('#'));
                if (lines.length > 0) {
                  result.context.push(`Memory (${mf.replace('.md', '')}): ${lines.slice(0, 3).join(' ').slice(0, 200)}`);
                }
              } catch {}
            }
          } catch {}
        }
      }
    } catch {}
  }

  return result.decisions.length > 0 || result.context.length > 0 ? result : null;
}

/**
 * Import from Cursor's .cursor/ directory.
 */
function importCursorData(projectRoot) {
  const cursorDir = path.join(projectRoot, '.cursor');
  if (!fs.existsSync(cursorDir)) return null;

  const result = { tool: 'Cursor', decisions: [], context: [] };

  // Read .cursor/rules/ for project rules
  const rulesDir = path.join(cursorDir, 'rules');
  if (fs.existsSync(rulesDir)) {
    try {
      const ruleFiles = fs.readdirSync(rulesDir).filter(f => f.endsWith('.mdc') || f.endsWith('.md'));
      for (const rf of ruleFiles) {
        if (rf.includes('mindswap')) continue; // Skip our own files
        try {
          const content = fs.readFileSync(path.join(rulesDir, rf), 'utf-8');
          const extracted = extractContextFromMarkdown(content, `Cursor (${rf})`);
          result.decisions.push(...extracted.decisions);
          result.context.push(...extracted.context);
        } catch {}
      }
    } catch {}
  }

  // Read legacy .cursorrules
  const legacyRules = path.join(projectRoot, '.cursorrules');
  if (fs.existsSync(legacyRules)) {
    try {
      const content = fs.readFileSync(legacyRules, 'utf-8');
      const extracted = extractContextFromMarkdown(content, 'Cursor (.cursorrules)');
      result.decisions.push(...extracted.decisions);
      result.context.push(...extracted.context);
    } catch {}
  }

  return result.decisions.length > 0 || result.context.length > 0 ? result : null;
}

/**
 * Import from Aider's .aider* files.
 */
function importAiderData(projectRoot) {
  const result = { tool: 'Aider', decisions: [], context: [] };

  // Read .aider.conf.yml
  const confPath = path.join(projectRoot, '.aider.conf.yml');
  if (fs.existsSync(confPath)) {
    try {
      const content = fs.readFileSync(confPath, 'utf-8');
      result.context.push(`Aider config: ${content.slice(0, 300)}`);
    } catch {}
  }

  // Read CONVENTIONS.md (aider convention)
  const convPath = path.join(projectRoot, 'CONVENTIONS.md');
  if (fs.existsSync(convPath)) {
    try {
      const content = fs.readFileSync(convPath, 'utf-8');
      const extracted = extractContextFromMarkdown(content, 'CONVENTIONS.md');
      result.decisions.push(...extracted.decisions);
      result.context.push(...extracted.context);
    } catch {}
  }

  return result.decisions.length > 0 || result.context.length > 0 ? result : null;
}

/**
 * Extract decisions and context from markdown content.
 * Looks for patterns that indicate decisions, conventions, or rules.
 */
function extractContextFromMarkdown(content, source) {
  const decisions = [];
  const context = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.replace(/^[#\-*>\s]+/, '').trim();
    if (!trimmed || trimmed.length < 10 || trimmed.length > 300) continue;
    if (trimmed.startsWith('```') || trimmed.startsWith('<!--') || trimmed.startsWith('http')) continue;

    // Decision patterns — things that express choices or rules
    const isDecision =
      /\b(use|using|prefer|chose|avoid|don't|never|always|must|should|require|enforce|forbid)\b/i.test(trimmed) &&
      /\b(over|instead|because|for|not|rather|than|when|if|every|all)\b/i.test(trimmed);

    // Convention patterns — coding standards, formatting rules
    const isConvention =
      /\b(naming|convention|style|format|pattern|structure|architecture|rule)\b/i.test(trimmed) ||
      /\b(camelCase|snake_case|PascalCase|kebab-case)\b/i.test(trimmed) ||
      /\b(eslint|prettier|linter|formatter)\b/i.test(trimmed);

    if (isDecision) {
      decisions.push(trimmed);
    } else if (isConvention) {
      context.push(`[${source}] ${trimmed}`);
    }
  }

  // Limit to avoid flooding
  return {
    decisions: decisions.slice(0, 15),
    context: context.slice(0, 10),
  };
}

module.exports = { importSessions, importClaudeSessions, importCursorData, extractContextFromMarkdown };
