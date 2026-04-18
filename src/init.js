const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { ensureRelayDir, writeState, getDefaultState } = require('./state');
const { detectProject } = require('./detect');
const { isGitRepo, getCurrentBranch } = require('./git');

async function init(projectRoot, opts = {}) {
  console.log(chalk.bold('\n⚡ Initializing relay-dev...\n'));

  // 1. Detect project
  const project = detectProject(projectRoot);
  console.log(chalk.dim('  Project:    ') + chalk.white(project.name));
  console.log(chalk.dim('  Language:   ') + chalk.white(project.language || 'unknown'));
  console.log(chalk.dim('  Framework:  ') + chalk.white(project.framework || 'none detected'));
  console.log(chalk.dim('  Stack:      ') + chalk.white(project.tech_stack.join(', ') || 'unknown'));
  console.log(chalk.dim('  Pkg manager:') + chalk.white(' ' + (project.package_manager || 'unknown')));

  // 2. Create .relay/ directory
  const relayDir = ensureRelayDir(projectRoot);
  console.log(chalk.dim('\n  Created:    ') + chalk.green('.relay/'));

  // 3. Create initial state
  const state = getDefaultState();
  state.project = project;
  state.current_task.status = 'idle';

  if (isGitRepo(projectRoot)) {
    state.last_checkpoint.git_branch = getCurrentBranch(projectRoot);
    console.log(chalk.dim('  Git branch: ') + chalk.white(state.last_checkpoint.git_branch));
  }

  writeState(projectRoot, state);
  console.log(chalk.dim('  Created:    ') + chalk.green('.relay/state.json'));

  // 4. Create config file
  const config = {
    auto_checkpoint_on_commit: true,
    auto_generate_handoff: true,
    generate_for: ['handoff', 'agents'],
    watch_patterns: ['src/**', 'lib/**', 'app/**', 'pages/**', 'components/**'],
    ignore_patterns: ['node_modules', 'dist', 'build', '.next', '.relay/history'],
    max_diff_lines: 200,
    max_history: 50,
  };
  fs.writeFileSync(
    path.join(relayDir, 'config.json'),
    JSON.stringify(config, null, 2),
    'utf-8'
  );
  console.log(chalk.dim('  Created:    ') + chalk.green('.relay/config.json'));

  // 5. Create initial decisions log
  fs.writeFileSync(
    path.join(relayDir, 'decisions.log'),
    `# Decision Log — ${project.name}\n# Tracks WHY decisions were made so the next AI knows.\n# Format: [timestamp] [tag] message\n\n`,
    'utf-8'
  );
  console.log(chalk.dim('  Created:    ') + chalk.green('.relay/decisions.log'));

  // 6. Install git hooks (optional)
  if (!opts.noHooks && isGitRepo(projectRoot)) {
    installGitHooks(projectRoot);
    console.log(chalk.dim('  Installed:  ') + chalk.green('git post-commit hook'));
  }

  // 7. Add to .gitignore if needed
  addToGitignore(projectRoot);

  // 8. Generate initial HANDOFF.md
  const { generate } = require('./generate');
  await generate(projectRoot, { handoff: true, quiet: true });
  console.log(chalk.dim('  Created:    ') + chalk.green('.relay/HANDOFF.md'));

  console.log(chalk.bold.green('\n✓ relay initialized!\n'));
  console.log(chalk.dim('  Quick start:'));
  console.log(chalk.white('    npx relay checkpoint "starting auth feature"'));
  console.log(chalk.white('    npx relay log "chose JWT over sessions for stateless API"'));
  console.log(chalk.white('    npx relay generate --all'));
  console.log(chalk.white('    npx relay watch'));
  console.log();
}

function installGitHooks(projectRoot) {
  const hooksDir = path.join(projectRoot, '.git', 'hooks');
  if (!fs.existsSync(hooksDir)) return;

  const hookPath = path.join(hooksDir, 'post-commit');
  const hookContent = `#!/bin/sh
# relay-dev: auto-checkpoint on commit
npx relay checkpoint "auto: post-commit" --next "" 2>/dev/null || true
`;

  // Don't overwrite existing hooks — append
  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf-8');
    if (existing.includes('relay-dev')) return; // Already installed
    fs.appendFileSync(hookPath, '\n' + hookContent);
  } else {
    fs.writeFileSync(hookPath, hookContent);
  }

  // Make executable
  try {
    fs.chmodSync(hookPath, '755');
  } catch {}
}

function addToGitignore(projectRoot) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const relayIgnore = '\n# relay-dev state (history is local)\n.relay/history/\n';

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (content.includes('.relay/history')) return;
    fs.appendFileSync(gitignorePath, relayIgnore);
  }
  // Note: .relay/state.json and HANDOFF.md SHOULD be committed — they're the handoff context
}

module.exports = { init };
