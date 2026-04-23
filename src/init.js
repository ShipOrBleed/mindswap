const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { ensureDataDir, writeState, getDefaultState } = require('./state');
const { detectProject } = require('./detect');
const { isGitRepo, getCurrentBranch } = require('./git');
const { detectMonorepo } = require('./monorepo');
const { ensureMemory, writeMemory, getDefaultMemory, appendMemoryItem, readMemory } = require('./memory');

async function init(projectRoot, opts = {}) {
  console.log(chalk.bold('\n⚡ Initializing mindswap...\n'));

  // 1. Detect project
  const project = detectProject(projectRoot);
  console.log(chalk.dim('  Project:    ') + chalk.white(project.name));
  console.log(chalk.dim('  Language:   ') + chalk.white(project.language || 'unknown'));
  console.log(chalk.dim('  Framework:  ') + chalk.white(project.framework || 'none detected'));
  console.log(chalk.dim('  Stack:      ') + chalk.white(project.tech_stack.join(', ') || 'unknown'));
  console.log(chalk.dim('  Pkg manager:') + chalk.white(' ' + (project.package_manager || 'unknown')));

  // 2. Create .mindswap/ directory
  const dataDir = ensureDataDir(projectRoot);
  console.log(chalk.dim('\n  Created:    ') + chalk.green('.mindswap/'));

  // 3. Create initial state
  const state = getDefaultState();
  state.project = project;
  state.current_task.status = 'idle';

  if (isGitRepo(projectRoot)) {
    state.last_checkpoint.git_branch = getCurrentBranch(projectRoot);
    console.log(chalk.dim('  Git branch: ') + chalk.white(state.last_checkpoint.git_branch));
  }

  // Detect monorepo
  const monorepo = detectMonorepo(projectRoot);
  if (monorepo.isMonorepo) {
    state.project.monorepo = monorepo.tool;
    state.project.packages = monorepo.packages.map(p => ({ name: p.name, path: p.relativePath }));
    if (!state.project.tech_stack.includes(monorepo.tool)) {
      state.project.tech_stack.push(monorepo.tool);
    }
    console.log(chalk.dim('  Monorepo:   ') + chalk.white(`${monorepo.tool} (${monorepo.packages.length} packages)`));
  }

  writeState(projectRoot, state);
  console.log(chalk.dim('  Created:    ') + chalk.green('.mindswap/state.json'));

  // 4. Create config file
  const config = {
    auto_checkpoint_on_commit: true,
    auto_generate_handoff: true,
    generate_for: ['handoff', 'agents'],
    watch_patterns: ['src/**', 'lib/**', 'app/**', 'pages/**', 'components/**'],
    ignore_patterns: ['node_modules', 'dist', 'build', '.next', '.mindswap/history'],
    max_diff_lines: 200,
    max_history: 50,
  };
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify(config, null, 2),
    'utf-8'
  );
  console.log(chalk.dim('  Created:    ') + chalk.green('.mindswap/config.json'));

  // 5. Create initial decisions log
  fs.writeFileSync(
    path.join(dataDir, 'decisions.log'),
    `# Decision Log — ${project.name}\n# Tracks WHY decisions were made so the next AI knows.\n# Format: [timestamp] [tag] message\n\n`,
    'utf-8'
  );
  console.log(chalk.dim('  Created:    ') + chalk.green('.mindswap/decisions.log'));

  ensureMemory(projectRoot);
  writeMemory(projectRoot, getDefaultMemory());
  console.log(chalk.dim('  Created:    ') + chalk.green('.mindswap/memory.json'));

  // 6. Import existing AI context files
  const importTracker = createImportTracker(projectRoot, dataDir);
  const imported = importExistingContext(projectRoot, dataDir, importTracker);
  if (imported > 0) {
    console.log(chalk.dim('  Imported:   ') + chalk.green(`${imported} decisions from existing AI context files`));
  }

  // 6b. Import AI session data (.claude/, .cursor/, etc.)
  try {
    const { importSessions } = require('./session-import');
    const sessions = importSessions(projectRoot);
    let sessionImported = 0;
    const decisionsPath = path.join(dataDir, 'decisions.log');
    const timestamp = new Date().toISOString();
    for (const session of sessions) {
      for (const d of session.decisions) {
        const added = appendImportedDecision(projectRoot, decisionsPath, importTracker, {
          type: 'decision',
          tag: `imported:${session.tool}`,
          message: d,
          created_at: timestamp,
          source: 'import',
        });
        if (added) sessionImported++;
      }
      for (const c of session.context) {
        const added = appendImportedMemory(projectRoot, importTracker, {
          type: 'assumption',
          tag: `context:${session.tool}`,
          message: c,
          created_at: timestamp,
          source: 'import',
        });
        if (added) sessionImported++;
      }
    }
    if (sessionImported > 0) {
      console.log(chalk.dim('  Sessions:   ') + chalk.green(`${sessionImported} context items from AI tool sessions`));
    }
  } catch {}

  // 6c. Import project README
  try {
    const readmePath = path.join(projectRoot, 'README.md');
    if (fs.existsSync(readmePath)) {
      const readme = fs.readFileSync(readmePath, 'utf-8');
      const description = extractProjectDescription(readme);
      if (description) {
        state.project.description = description;
        writeState(projectRoot, state);
        console.log(chalk.dim('  README:     ') + chalk.green('project description extracted'));
      }
    }
  } catch {}

  // 7. Install git hooks (optional)
  if (opts.hooks !== false && isGitRepo(projectRoot)) {
    installGitHooks(projectRoot);
    console.log(chalk.dim('  Installed:  ') + chalk.green('git post-commit hook'));
  }

  // 8. Add to .gitignore if needed
  addToGitignore(projectRoot);

  // 9. Generate initial HANDOFF.md
  const { generate } = require('./generate');
  await generate(projectRoot, { handoff: true, quiet: true });
  console.log(chalk.dim('  Created:    ') + chalk.green('HANDOFF.md'));

  console.log(chalk.bold.green('\n✓ mindswap initialized!\n'));
  console.log(chalk.dim('  Quick start:'));
  console.log(chalk.white('    npx mindswap cp "starting auth feature"'));
  console.log(chalk.white('    npx mindswap log "chose JWT over sessions"'));
  console.log(chalk.white('    npx mindswap gen --all'));
  console.log(chalk.white('    npx mindswap switch cursor'));
  console.log();
}

/**
 * Import context from existing AI tool files (CLAUDE.md, AGENTS.md, .cursorrules, etc.)
 * Extracts decisions and context into the decisions log.
 */
function importExistingContext(projectRoot, dataDir, importTracker) {
  const decisionsPath = path.join(dataDir, 'decisions.log');
  let imported = 0;
  const timestamp = new Date().toISOString();

  const filesToCheck = [
    { path: 'CLAUDE.md', source: 'Claude Code' },
    { path: 'AGENTS.md', source: 'AGENTS.md' },
    { path: '.cursorrules', source: 'Cursor' },
    { path: '.cursor/rules', source: 'Cursor', isDir: true },
    { path: '.github/copilot-instructions.md', source: 'GitHub Copilot' },
  ];

  for (const file of filesToCheck) {
    const fullPath = path.join(projectRoot, file.path);
    if (!fs.existsSync(fullPath)) continue;

    if (file.isDir) {
      // Read all .mdc files in directory
      try {
        const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.mdc') || f.endsWith('.md'));
        for (const f of files) {
          const content = fs.readFileSync(path.join(fullPath, f), 'utf-8');
          const decisions = extractDecisionsFromContent(content);
          for (const d of decisions) {
            const added = appendImportedDecision(projectRoot, decisionsPath, importTracker, {
              type: 'decision',
              tag: `imported:${file.source}`,
              message: d,
              created_at: timestamp,
              source: 'import',
            });
            if (added) imported++;
          }
        }
      } catch {}
    } else {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const decisions = extractDecisionsFromContent(content);
        for (const d of decisions) {
          const added = appendImportedDecision(projectRoot, decisionsPath, importTracker, {
            type: 'decision',
            tag: `imported:${file.source}`,
            message: d,
            created_at: timestamp,
            source: 'import',
          });
          if (added) imported++;
        }
      } catch {}
    }
  }

  return imported;
}

function createImportTracker(projectRoot, dataDir) {
  const decisionKeys = new Set();
  const memoryKeys = new Set();
  const decisionsPath = path.join(dataDir, 'decisions.log');

  if (fs.existsSync(decisionsPath)) {
    const lines = fs.readFileSync(decisionsPath, 'utf-8').split('\n').filter(line => line.startsWith('['));
    for (const line of lines) {
      const match = line.match(/^\[[^\]]+\]\s+\[([^\]]+)\]\s+(.+)$/);
      if (!match) continue;
      decisionKeys.add(`${match[1]}::${match[2]}`);
    }
  }

  const memory = readMemory(projectRoot);
  for (const item of memory.items) {
    memoryKeys.add(`${item.type}::${item.tag}::${item.message}`);
  }

  return { decisionKeys, memoryKeys };
}

function appendImportedDecision(projectRoot, decisionsPath, tracker, item) {
  const decisionKey = `${item.tag}::${item.message}`;
  const memoryKey = `${item.type}::${item.tag}::${item.message}`;
  if (tracker.decisionKeys.has(decisionKey) || tracker.memoryKeys.has(memoryKey)) {
    return false;
  }

  fs.appendFileSync(decisionsPath, `[${item.created_at}] [${item.tag}] ${item.message}\n`);
  appendMemoryItem(projectRoot, item);
  tracker.decisionKeys.add(decisionKey);
  tracker.memoryKeys.add(memoryKey);
  return true;
}

function appendImportedMemory(projectRoot, tracker, item) {
  const memoryKey = `${item.type}::${item.tag}::${item.message}`;
  if (tracker.memoryKeys.has(memoryKey)) {
    return false;
  }

  appendMemoryItem(projectRoot, item);
  tracker.memoryKeys.add(memoryKey);
  return true;
}

/**
 * Extract decision-like statements from markdown content.
 * Looks for patterns like "use X", "don't use Y", "prefer X over Y", etc.
 */
function extractDecisionsFromContent(content) {
  const decisions = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.replace(/^[#\-*>\s]+/, '').trim();
    if (!trimmed || trimmed.length < 10 || trimmed.length > 200) continue;

    // Skip headings, links, code blocks
    if (trimmed.startsWith('```') || trimmed.startsWith('<!--')) continue;

    // Look for decision-like patterns
    const isDecision =
      /\b(use|using|prefer|chose|avoid|don't|never|always|must|should)\b/i.test(trimmed) &&
      /\b(over|instead|because|for|not|rather)\b/i.test(trimmed);

    if (isDecision) {
      decisions.push(trimmed);
    }
  }

  // Limit to avoid flooding
  return decisions.slice(0, 10);
}

function installGitHooks(projectRoot) {
  const hooksDir = path.join(projectRoot, '.git', 'hooks');
  if (!fs.existsSync(hooksDir)) return;

  const hookPath = path.join(hooksDir, 'post-commit');
  const hookContent = `#!/bin/sh
# mindswap: auto-save state on commit
npx mindswap save --quiet 2>/dev/null || true
`;

  // Don't overwrite existing hooks — append
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8');
    if (existing.includes('mindswap')) return;
    fs.appendFileSync(hookPath, '\n' + hookContent);
  } else {
    fs.writeFileSync(hookPath, hookContent);
  }

  try {
    fs.chmodSync(hookPath, '755');
  } catch {}
}

function addToGitignore(projectRoot) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const ignore = '\n# mindswap state (history + branches are local)\n.mindswap/history/\n.mindswap/branches/\n';

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (content.includes('.mindswap/history')) return;
    fs.appendFileSync(gitignorePath, ignore);
  }
}

/**
 * Extract project description from README.md.
 * Takes the first meaningful paragraph after the title.
 */
function extractProjectDescription(readme) {
  const lines = readme.split('\n');
  let foundTitle = false;
  const descLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip badges, empty lines, and the title
    if (trimmed.startsWith('# ') && !foundTitle) { foundTitle = true; continue; }
    if (!foundTitle) continue;
    if (trimmed.startsWith('[![') || trimmed.startsWith('![') || trimmed === '') {
      if (descLines.length > 0) break; // Found desc, hit empty line = done
      continue;
    }
    if (trimmed.startsWith('## ')) break; // Hit next section
    if (trimmed.startsWith('```')) break;
    if (trimmed.startsWith('|')) break; // Table

    descLines.push(trimmed.replace(/^\*\*(.+)\*\*$/, '$1')); // Strip bold wrapper
    if (descLines.length >= 3) break; // Max 3 lines
  }

  const desc = descLines.join(' ').slice(0, 500);
  return desc.length > 15 ? desc : null;
}

module.exports = { init, importExistingContext, extractDecisionsFromContent, extractProjectDescription };
