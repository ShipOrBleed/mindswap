const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const { getDataDir, readState, getHistory, sanitizeBranch } = require('./state');
const { isGitRepo, getCurrentBranch } = require('./git');
const { detectAITool } = require('./detect-ai');
const { detectLastStatus } = require('./build-test');
const { findAllConflicts, checkDepsVsDecisions } = require('./conflicts');
const { calculateQualityScore } = require('./narrative');
const { analyzeGuardrails } = require('./guardrails');

async function doctor(projectRoot, opts = {}) {
  const report = analyzeProjectHealth(projectRoot);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printDoctorReport(report);
  }

  if (report.summary.issues > 0) {
    process.exitCode = 1;
  }

  return report;
}

function analyzeProjectHealth(projectRoot) {
  const dataDir = getDataDir(projectRoot);
  const checks = [];
  const live = {
    branch: null,
    changedFiles: [],
    recentCommits: [],
    decisions: [],
    history: [],
  };

  if (!fs.existsSync(dataDir)) {
    addCheck(checks, 'issue', 'mindswap is not initialized', 'Run `npx mindswap init` in this project.');
    return finalizeReport(projectRoot, checks);
  }

  addCheck(checks, 'ok', 'mindswap data directory exists');

  const statePath = path.join(dataDir, 'state.json');
  const configPath = path.join(dataDir, 'config.json');
  const decisionsPath = path.join(dataDir, 'decisions.log');
  const handoffPath = path.join(projectRoot, 'HANDOFF.md');
  const localHandoffPath = path.join(dataDir, 'HANDOFF.md');

  if (fs.existsSync(statePath)) addCheck(checks, 'ok', 'state.json is present');
  else addCheck(checks, 'issue', 'state.json is missing', 'Re-run `npx mindswap init` to repair project state.');

  if (fs.existsSync(configPath)) addCheck(checks, 'ok', 'config.json is present');
  else addCheck(checks, 'warning', 'config.json is missing', 'Re-run `npx mindswap init` to restore default config.');

  if (fs.existsSync(decisionsPath)) addCheck(checks, 'ok', 'decisions log is present');
  else addCheck(checks, 'warning', 'decisions.log is missing', 'Create it with `npx mindswap init` or restore it from history.');

  if (fs.existsSync(handoffPath)) addCheck(checks, 'ok', 'HANDOFF.md exists at project root');
  else addCheck(checks, 'issue', 'HANDOFF.md is missing', 'Run `npx mindswap` or `npx mindswap gen --handoff`.');

  if (fs.existsSync(localHandoffPath)) addCheck(checks, 'ok', 'local .mindswap/HANDOFF.md exists');
  else addCheck(checks, 'warning', '.mindswap/HANDOFF.md is missing', 'Run `npx mindswap gen --handoff` to regenerate local handoff state.');

  if (fs.existsSync(statePath)) {
    const freshnessInputs = [statePath, decisionsPath].filter(fs.existsSync);
    const staleRootHandoff = isStale(handoffPath, freshnessInputs);
    const staleLocalHandoff = isStale(localHandoffPath, freshnessInputs);

    if (fs.existsSync(handoffPath) && !staleRootHandoff) {
      addCheck(checks, 'ok', 'project HANDOFF.md is fresh');
    } else if (fs.existsSync(handoffPath)) {
      addCheck(checks, 'warning', 'project HANDOFF.md looks stale', 'Run `npx mindswap` to refresh generated context files.');
    }

    if (fs.existsSync(localHandoffPath) && !staleLocalHandoff) {
      addCheck(checks, 'ok', 'local .mindswap/HANDOFF.md is fresh');
    } else if (fs.existsSync(localHandoffPath)) {
      addCheck(checks, 'warning', 'local .mindswap/HANDOFF.md looks stale', 'Run `npx mindswap gen --handoff` to refresh local context.');
    }
  }

  let state = null;
  try {
    state = readState(projectRoot);
  } catch (err) {
    addCheck(checks, 'issue', 'state.json could not be read', err.message);
  }

  if (state) {
    live.history = getHistory(projectRoot, 5);
    if (fs.existsSync(decisionsPath)) {
      live.decisions = fs.readFileSync(decisionsPath, 'utf-8').split('\n').filter(line => line.startsWith('['));
    }

    if (state.last_checkpoint?.timestamp) {
      addCheck(checks, 'ok', `last checkpoint recorded ${timeAgo(new Date(state.last_checkpoint.timestamp))}`);
    } else {
      addCheck(checks, 'warning', 'no checkpoint has been recorded yet', 'Run `npx mindswap` after meaningful work to establish context.');
    }

    if (state.current_task?.started_at && state.current_task.status === 'in_progress') {
      const ageHours = (Date.now() - new Date(state.current_task.started_at).getTime()) / 3600000;
      if (ageHours > 72) {
        addCheck(checks, 'warning', `current task has been in progress for ${Math.floor(ageHours / 24)}d`, 'Consider checkpointing, pausing, or marking the task done.');
      }
    }

    const statusProbe = detectLastStatus(projectRoot);
    if (state.test_status || statusProbe.test) {
      addCheck(checks, 'ok', 'test status is available');
    } else if (expectsTestStatus(projectRoot)) {
      addCheck(checks, 'warning', 'test status is missing or stale', 'Run `npx mindswap --check` to capture current test results.');
    }

    if (state.build_status || statusProbe.build) {
      addCheck(checks, 'ok', 'build status is available');
    } else if (expectsBuildStatus(projectRoot)) {
      addCheck(checks, 'warning', 'build status is missing', 'Capture a build result during checkpointing if this project has a build step.');
    }
  }

  if (isGitRepo(projectRoot)) {
    const branch = getCurrentBranch(projectRoot);
    live.branch = branch;
    addCheck(checks, 'ok', `git repo detected on branch ${branch}`);

    const branchStatePath = path.join(dataDir, 'branches', `${sanitizeBranch(branch)}.json`);
    if (fs.existsSync(branchStatePath)) {
      addCheck(checks, 'ok', 'branch-specific state file exists');
    } else {
      addCheck(checks, 'warning', 'branch-specific state file is missing', 'Run `npx mindswap` to write branch-aware state for the current branch.');
    }

    const hookStatus = inspectPostCommitHook(projectRoot);
    if (hookStatus.level === 'ok') addCheck(checks, 'ok', hookStatus.message);
    else addCheck(checks, hookStatus.level, hookStatus.message, hookStatus.fix);
  } else {
    addCheck(checks, 'warning', 'project is not a git repository', 'Initialize git to unlock branch-aware state and auto-checkpoints.');
  }

  const conflicts = findAllConflicts(projectRoot);
  const depConflicts = checkDepsVsDecisions(projectRoot);
  if (conflicts.length === 0) {
    addCheck(checks, 'ok', 'no decision conflicts detected');
  } else {
    addCheck(checks, 'issue', `${conflicts.length} decision conflict${conflicts.length === 1 ? '' : 's'} detected`, conflicts[0].reason);
  }

  if (depConflicts.length === 0) {
    addCheck(checks, 'ok', 'no dependency-vs-decision conflicts detected');
  } else {
    addCheck(checks, 'issue', `${depConflicts.length} dependency conflict${depConflicts.length === 1 ? '' : 's'} detected`, depConflicts[0].reason);
  }

  const guardrails = analyzeGuardrails(projectRoot);
  if (guardrails.warnings.length === 0) {
    addCheck(checks, 'ok', 'no architectural drift signals detected');
  } else {
    addCheck(checks, 'warning', `${guardrails.warnings.length} architectural drift signal${guardrails.warnings.length === 1 ? '' : 's'} detected`, guardrails.warnings[0].reason);
  }

  const aiContextStatus = inspectAIContextFiles(projectRoot);
  for (const item of aiContextStatus) {
    addCheck(checks, item.level, item.message, item.fix);
  }

  if (state) {
    const quality = calculateQualityScore(state, live);
    if (quality.score >= 75) {
      addCheck(checks, 'ok', `context quality is ${quality.grade} (${quality.score}/100)`);
    } else {
      addCheck(checks, 'warning', `context quality is ${quality.grade} (${quality.score}/100)`, quality.missing[0] || 'Add more task, test, and decision context.');
    }
  }

  return finalizeReport(projectRoot, checks);
}

function inspectPostCommitHook(projectRoot) {
  const hookPath = path.join(projectRoot, '.git', 'hooks', 'post-commit');
  if (!fs.existsSync(hookPath)) {
    return {
      level: 'warning',
      message: 'git post-commit hook is missing',
      fix: 'Run `npx mindswap init` to install the default post-commit hook.',
    };
  }

  const content = fs.readFileSync(hookPath, 'utf-8');
  if (!content.includes('mindswap save --quiet')) {
    return {
      level: 'warning',
      message: 'git post-commit hook does not include mindswap auto-save',
      fix: 'Re-run `npx mindswap init` or add the mindswap hook stanza manually.',
    };
  }

  return { level: 'ok', message: 'git post-commit hook includes mindswap auto-save' };
}

function inspectAIContextFiles(projectRoot) {
  const checks = [];
  const detected = detectAITool(projectRoot);
  if (!detected) {
    checks.push({ level: 'ok', message: 'no AI-tool specific context files detected' });
    return checks;
  }

  checks.push({ level: 'ok', message: `detected AI tool context: ${detected}` });

  const expectations = [
    { label: 'Claude Code', file: path.join(projectRoot, 'CLAUDE.md'), fix: 'Run `npx mindswap gen --claude`.' },
    { label: 'Cursor', file: path.join(projectRoot, '.cursor', 'rules', 'mindswap-context.mdc'), fix: 'Run `npx mindswap gen --cursor`.' },
    { label: 'GitHub Copilot', file: path.join(projectRoot, '.github', 'copilot-instructions.md'), fix: 'Run `npx mindswap gen --copilot`.' },
    { label: 'Codex', file: path.join(projectRoot, 'CODEX.md'), fix: 'Run `npx mindswap gen --codex`.' },
    { label: 'AI Agent (AGENTS.md)', file: path.join(projectRoot, 'AGENTS.md'), fix: 'Run `npx mindswap gen --agents`.' },
    { label: 'Windsurf', file: path.join(projectRoot, '.windsurfrules'), fix: 'Run `npx mindswap gen --windsurf`.' },
    { label: 'Cline', file: path.join(projectRoot, '.cline', 'mindswap-context.md'), fix: 'Run `npx mindswap gen --cline`.' },
    { label: 'Roo Code', file: path.join(projectRoot, '.roo', 'rules', 'mindswap-context.md'), fix: 'Run `npx mindswap gen --roo`.' },
  ];

  for (const expected of expectations) {
    if (!detected.includes(expected.label)) continue;
    if (fs.existsSync(expected.file)) {
      checks.push({ level: 'ok', message: `${expected.label} context file exists` });
    } else {
      checks.push({ level: 'warning', message: `${expected.label} context file is missing`, fix: expected.fix });
    }
  }

  return checks;
}

function isStale(targetFile, sourceFiles) {
  if (!fs.existsSync(targetFile) || sourceFiles.length === 0) return false;
  const targetMtime = fs.statSync(targetFile).mtimeMs;
  const newestSource = Math.max(...sourceFiles.map(file => fs.statSync(file).mtimeMs));
  return newestSource - targetMtime > 1000;
}

function expectsTestStatus(projectRoot) {
  const pkg = readPackageJson(projectRoot);
  if (pkg) {
    const scripts = pkg.scripts || {};
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (scripts.test && !scripts.test.includes('no test specified')) return true;
    if (deps.jest || deps.vitest || deps.mocha || deps.ava || deps['@playwright/test']) return true;
  }

  return fs.existsSync(path.join(projectRoot, 'go.mod')) ||
    fs.existsSync(path.join(projectRoot, 'Cargo.toml')) ||
    fs.existsSync(path.join(projectRoot, 'pytest.ini')) ||
    fs.existsSync(path.join(projectRoot, 'pyproject.toml'));
}

function expectsBuildStatus(projectRoot) {
  const pkg = readPackageJson(projectRoot);
  if (pkg?.scripts?.build) return true;
  return fs.existsSync(path.join(projectRoot, 'go.mod'));
}

function readPackageJson(projectRoot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
  } catch {
    return null;
  }
}

function addCheck(checks, level, message, fix = null) {
  checks.push({ level, message, fix });
}

function finalizeReport(projectRoot, checks) {
  const summary = {
    ok: checks.filter(check => check.level === 'ok').length,
    warnings: checks.filter(check => check.level === 'warning').length,
    issues: checks.filter(check => check.level === 'issue').length,
  };

  let status = 'healthy';
  if (summary.issues > 0) status = 'failing';
  else if (summary.warnings > 0) status = 'warning';

  return {
    projectRoot,
    status,
    summary,
    checks,
  };
}

function printDoctorReport(report) {
  console.log(chalk.bold('\n⚡ mindswap doctor\n'));
  console.log(chalk.dim('  Status:      ') + colorStatus(report.status));
  console.log(chalk.dim('  Checks:      ') + chalk.white(`${report.summary.ok} ok, ${report.summary.warnings} warnings, ${report.summary.issues} issues`));

  printGroup(report.checks, 'issue', chalk.red, 'Issues');
  printGroup(report.checks, 'warning', chalk.yellow, 'Warnings');
  printGroup(report.checks, 'ok', chalk.green, 'OK');

  console.log();
}

function printGroup(checks, level, color, label) {
  const items = checks.filter(check => check.level === level);
  if (items.length === 0) return;

  console.log(chalk.bold(`\n${label}`));
  for (const item of items) {
    console.log(color(`  • ${item.message}`));
    if (item.fix) {
      console.log(chalk.dim(`    ${item.fix}`));
    }
  }
}

function colorStatus(status) {
  if (status === 'healthy') return chalk.green(status);
  if (status === 'warning') return chalk.yellow(status);
  return chalk.red(status);
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

module.exports = {
  doctor,
  analyzeProjectHealth,
  inspectPostCommitHook,
  inspectAIContextFiles,
};
