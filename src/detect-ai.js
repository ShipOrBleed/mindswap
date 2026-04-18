const fs = require('fs');
const path = require('path');

/**
 * Detect which AI tools are being used in this project based on
 * tool-specific files and directories. File-based detection only —
 * no process scanning (too slow and unreliable).
 */
function detectAITool(projectRoot) {
  const checks = [
    { path: '.claude', name: 'Claude Code' },
    { path: 'CLAUDE.md', name: 'Claude Code' },
    { path: '.cursor', name: 'Cursor' },
    { path: '.github/copilot-instructions.md', name: 'GitHub Copilot' },
    { path: '.codex', name: 'Codex' },
    { path: '.windsurf', name: 'Windsurf' },
    { path: '.cline', name: 'Cline' },
    { path: '.roo', name: 'Roo Code' },
    { path: 'AGENTS.md', name: 'AI Agent (AGENTS.md)' },
  ];

  const detected = new Set();
  for (const check of checks) {
    if (fs.existsSync(path.join(projectRoot, check.path))) {
      detected.add(check.name);
    }
  }

  // Check environment variables (set by some AI tools when running)
  if (process.env.CLAUDE_CODE) detected.add('Claude Code');
  if (process.env.CURSOR_SESSION) detected.add('Cursor');

  const unique = [...detected];
  return unique.length > 0 ? unique.join(', ') : null;
}

function getAllAIContextFiles(projectRoot) {
  const files = {
    'CLAUDE.md': fs.existsSync(path.join(projectRoot, 'CLAUDE.md')),
    'AGENTS.md': fs.existsSync(path.join(projectRoot, 'AGENTS.md')),
    '.cursor/rules': fs.existsSync(path.join(projectRoot, '.cursor', 'rules')),
    '.github/copilot-instructions.md': fs.existsSync(path.join(projectRoot, '.github', 'copilot-instructions.md')),
    '.windsurf/rules': fs.existsSync(path.join(projectRoot, '.windsurf', 'rules')),
    '.cline/rules': fs.existsSync(path.join(projectRoot, '.cline', 'rules')),
    'HANDOFF.md': fs.existsSync(path.join(projectRoot, 'HANDOFF.md')),
  };
  return files;
}

module.exports = { detectAITool, getAllAIContextFiles };
