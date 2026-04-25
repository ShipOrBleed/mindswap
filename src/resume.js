const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const { readState, getDataDir } = require('./state');
const { findAllConflicts, checkDepsVsDecisions } = require('./conflicts');
const { calculateQualityScore } = require('./narrative');
const { createProjectSnapshot } = require('./project-snapshot');

async function resume(projectRoot, opts = {}) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    console.log(chalk.yellow('\nmindswap not initialized. Run: npx mindswap init\n'));
    return;
  }

  const snapshot = createProjectSnapshot(projectRoot, { historyLimit: 20, recentCommitLimit: 5 });
  const state = snapshot.state;
  const live = gatherResumeData(projectRoot, snapshot);
  const briefing = buildResumeBriefing(state, live, opts);

  if (opts.json) {
    console.log(JSON.stringify(briefing, null, 2));
    return;
  }

  console.log(chalk.bold('\n⚡ Resume Briefing\n'));
  console.log(chalk.white(briefing.summary));
  console.log();
  console.log(chalk.bold('  State'));
  for (const line of briefing.stateLines) {
    console.log(chalk.dim('  ') + line);
  }
  console.log();
  console.log(chalk.bold('  Recommendation'));
  console.log(chalk.cyan(`  ${briefing.recommendation.summary}`));
  for (const step of briefing.recommendation.next_steps) {
    console.log(chalk.dim('    • ') + chalk.white(step));
  }
  if (briefing.recommendation.command) {
    console.log(chalk.dim('  Next command: ') + chalk.white(briefing.recommendation.command));
  }
  console.log();
}

function gatherResumeData(projectRoot, snapshot = null) {
  const liveSnapshot = snapshot || createProjectSnapshot(projectRoot, { historyLimit: 20, recentCommitLimit: 5 });
  const branch = liveSnapshot.branch;
  const changedFiles = liveSnapshot.changedFiles;
  const recentCommits = liveSnapshot.recentCommits;
  const history = liveSnapshot.history || [];
  const nativeSessions = liveSnapshot.nativeSessions || [];
  const decisions = liveSnapshot.decisions || readDecisions(projectRoot);
  const structuredMemory = Array.isArray(liveSnapshot.memory?.items) ? liveSnapshot.memory.items.slice(-20) : [];
  const blockers = structuredMemory.filter(item => item.type === 'blocker' && item.status === 'open').slice(-5);
  const questions = structuredMemory.filter(item => item.type === 'question' && item.status === 'open').slice(-5);
  const conflicts = findAllConflicts(projectRoot);
  const depConflicts = checkDepsVsDecisions(projectRoot);

  return {
    branch,
    changedFiles,
    recentCommits,
    history,
    nativeSessions,
    decisions,
    structuredMemory,
    blockers,
    questions,
    conflicts,
    depConflicts,
  };
}

function buildResumeBriefing(state, live, opts = {}) {
  const proj = state.project || {};
  const task = state.current_task || {};
  const quality = calculateQualityScore(state, {
    branch: live.branch,
    changedFiles: live.changedFiles,
    recentCommits: live.recentCommits,
    decisions: live.decisions,
    history: live.history,
  });

  const stateLines = [];
  stateLines.push(`Project: ${proj.name || 'unknown'}`);
  stateLines.push(`Branch: ${live.branch || 'unknown'}`);
  stateLines.push(`Task: ${task.description || 'no active task'} [${task.status || 'unknown'}]`);

  if (task.blocker) stateLines.push(`Blocker: ${task.blocker}`);
  if (task.next_steps?.length) stateLines.push(`Next steps: ${task.next_steps.join(', ')}`);

  if (state.test_status) {
    const ts = state.test_status;
    let detail = ts.status;
    if (ts.passed != null) detail = `${ts.passed} passed, ${ts.failed || 0} failed`;
    stateLines.push(`Tests: ${detail}`);
  }
  if (state.build_status) {
    stateLines.push(`Build: ${state.build_status.status}`);
  }

  if (live.changedFiles.length > 0) {
    stateLines.push(`Uncommitted changes: ${live.changedFiles.length} file(s)`);
  }
  if (live.recentCommits.length > 0) {
    stateLines.push(`Recent commit: ${live.recentCommits[0].message}`);
  }
  if (live.blockers.length > 0) {
    stateLines.push(`Open blocker: ${live.blockers[0].message}`);
  }
  if (live.questions.length > 0) {
    stateLines.push(`Open question: ${live.questions[0].message}`);
  }
  if (live.nativeSessions.length > 0) {
    stateLines.push(`Native sessions: ${live.nativeSessions.length} relevant session(s)`);
  }
  if (live.conflicts.length + live.depConflicts.length > 0) {
    stateLines.push(`Conflicts detected: ${live.conflicts.length + live.depConflicts.length}`);
  }

  const recommendation = recommendNextAction(state, live, quality);

  return {
    summary: opts.compact
      ? `${proj.name || 'project'} · ${recommendation.summary}`
      : 'Resume from the current branch with the next best action, not a raw state dump.',
    state: {
      project: proj,
      task,
      branch: live.branch,
      recent_commits: live.recentCommits.slice(0, 5),
      changed_files: live.changedFiles,
      tests: state.test_status || null,
      build: state.build_status || null,
      quality,
      native_sessions: live.nativeSessions,
      blockers: live.blockers,
      questions: live.questions,
      conflicts: live.conflicts,
      dep_conflicts: live.depConflicts,
    },
    stateLines,
    recommendation,
  };
}

function recommendNextAction(state, live, quality) {
  const task = state.current_task || {};
  if (task.blocker) {
    return {
      summary: `Resolve the active blocker first: ${task.blocker}`,
      next_steps: [
        'Confirm the blocker is still current.',
        'Unblock the dependency or decision before making broader changes.',
      ],
      command: 'npx mindswap status',
    };
  }

  if (state.test_status?.status === 'fail' || (state.test_status && state.test_status.failed > 0)) {
    return {
      summary: 'Fix failing tests before continuing feature work.',
      next_steps: [
        'Open the failing test output and identify the first regression.',
        'Run the smallest targeted fix, then re-run tests.',
      ],
      command: 'npm test',
    };
  }

  if (live.conflicts.length + live.depConflicts.length > 0) {
    return {
      summary: 'Resolve continuity conflicts before extending the feature.',
      next_steps: [
        'Review the detected decision or dependency conflicts.',
        'Update the project memory so the next session does not repeat the mismatch.',
      ],
      command: 'npx mindswap doctor',
    };
  }

  if (live.changedFiles.length > 0) {
    return {
      summary: 'Review uncommitted changes and regenerate context if needed.',
      next_steps: [
        'Inspect the current diff and ensure the handoff reflects the latest edits.',
        'Save the checkpoint once the state is coherent.',
      ],
      command: 'npx mindswap',
    };
  }

  if (task.description && task.status !== 'idle') {
    return {
      summary: `Continue the active task: ${task.description}`,
      next_steps: task.next_steps?.length ? task.next_steps : ['Pick the next concrete implementation step.'],
      command: 'npx mindswap status',
    };
  }

  if (quality.score < 75 && quality.missing?.length > 0) {
    return {
      summary: `Improve handoff quality: ${quality.missing[0]}`,
      next_steps: [
        'Capture the missing context before switching tools again.',
        'Run a fresh save to regenerate the handoff files.',
      ],
      command: 'npx mindswap doctor',
    };
  }

  return {
    summary: 'No active blocker detected. Re-open the current task or choose the next feature to continue.',
    next_steps: [
      'Check the current task state.',
      'If the feature is complete, mark it done and start the next one.',
    ],
    command: 'npx mindswap status',
  };
}

function readDecisions(projectRoot) {
  const decisionsPath = path.join(projectRoot, '.mindswap', 'decisions.log');
  if (!fs.existsSync(decisionsPath)) return [];
  return fs.readFileSync(decisionsPath, 'utf-8')
    .split('\n')
    .filter(line => line.startsWith('['));
}

module.exports = {
  resume,
  gatherResumeData,
  buildResumeBriefing,
  recommendNextAction,
};
