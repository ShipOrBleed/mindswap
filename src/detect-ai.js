const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function detectAITool(projectRoot) {
  // Check for tool-specific files/directories
  const checks = [
    { path: '.claude', name: 'Claude Code' },
    { path: 'CLAUDE.md', name: 'Claude Code' },
    { path: '.cursor', name: 'Cursor' },
    { path: '.cursor/rules', name: 'Cursor' },
    { path: '.github/copilot-instructions.md', name: 'GitHub Copilot' },
    { path: '.codex', name: 'Codex' },
    { path: '.windsurf', name: 'Windsurf' },
    { path: '.cline', name: 'Cline' },
    { path: '.roo', name: 'Roo Code' },
    { path: '.agent', name: 'AI Agent (generic)' },
    { path: 'AGENTS.md', name: 'AI Agent (AGENTS.md)' },
  ];

  const detected = [];
  for (const check of checks) {
    if (fs.existsSync(path.join(projectRoot, check.path))) {
      detected.push(check.name);
    }
  }

  // Check running processes (best effort)
  try {
    const procs = execSync('ps aux 2>/dev/null || tasklist 2>/dev/null', { encoding: 'utf-8', stdio: 'pipe' }).toLowerCase();
    if (procs.includes('claude') && !detected.includes('Claude Code')) detected.push('Claude Code');
    if (procs.includes('cursor') && !detected.includes('Cursor')) detected.push('Cursor');
    if (procs.includes('codex') && !detected.includes('Codex')) detected.push('Codex');
    if (procs.includes('windsurf') && !detected.includes('Windsurf')) detected.push('Windsurf');
  } catch {}

  // Deduplicate and return
  const unique = [...new Set(detected)];
  return unique.length > 0 ? unique.join(', ') : null;
}

function getAllAIContextFiles(projectRoot) {
  const files = {
    'CLAUDE.md': fs.existsSync(path.join(projectRoot, 'CLAUDE.md')),
    'AGENTS.md': fs.existsSync(path.join(projectRoot, 'AGENTS.md')),
    '.cursorrules': fs.existsSync(path.join(projectRoot, '.cursorrules')),
    '.cursor/rules': fs.existsSync(path.join(projectRoot, '.cursor', 'rules')),
    '.github/copilot-instructions.md': fs.existsSync(path.join(projectRoot, '.github', 'copilot-instructions.md')),
    '.windsurf/rules': fs.existsSync(path.join(projectRoot, '.windsurf', 'rules')),
    '.cline/rules': fs.existsSync(path.join(projectRoot, '.cline', 'rules')),
  };
  return files;
}

module.exports = { detectAITool, getAllAIContextFiles };
