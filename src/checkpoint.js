const chalk = require('chalk');
const { readState, updateState, addToHistory } = require('./state');
const { isGitRepo, getCurrentBranch, getAllChangedFiles, getDiffSummary, getRecentCommits, getLastCommitInfo } = require('./git');
const { detectAITool } = require('./detect-ai');

async function checkpoint(projectRoot, message, opts = {}) {
  const now = new Date().toISOString();
  const state = readState(projectRoot);

  // Detect which AI tool might be running
  const aiTool = detectAITool(projectRoot);

  // Gather git info
  let gitInfo = {};
  if (isGitRepo(projectRoot)) {
    gitInfo = {
      git_branch: getCurrentBranch(projectRoot),
      files_changed: getAllChangedFiles(projectRoot).map(f => `${f.status}: ${f.file}`),
      git_diff_summary: getDiffSummary(projectRoot),
      recent_commits: getRecentCommits(projectRoot, 3),
      last_commit: getLastCommitInfo(projectRoot),
    };
  }

  // Build checkpoint
  const checkpointData = {
    timestamp: now,
    message: message || 'manual checkpoint',
    ai_tool: aiTool,
    ...gitInfo,
  };

  // Update current task if flags provided
  const taskUpdates = {};
  if (opts.task) taskUpdates.description = opts.task;
  if (opts.blocker) taskUpdates.blocker = opts.blocker;
  if (opts.next) taskUpdates.next_steps = [opts.next];
  if (message && !opts.task && state.current_task.status === 'idle') {
    taskUpdates.description = message;
    taskUpdates.status = 'in_progress';
    taskUpdates.started_at = now;
  }

  // Update state
  const updates = {
    last_checkpoint: checkpointData,
    modified_files: gitInfo.files_changed || [],
  };
  if (Object.keys(taskUpdates).length > 0) {
    updates.current_task = taskUpdates;
  }

  const newState = updateState(projectRoot, updates);

  // Save to history
  const historyEntry = {
    ...checkpointData,
    task: newState.current_task,
    project: newState.project.name,
  };
  const historyFile = addToHistory(projectRoot, historyEntry);

  // Auto-generate HANDOFF.md
  try {
    const { readState: rs } = require('./state');
    const config = getConfig(projectRoot);
    if (config.auto_generate_handoff) {
      const { generate } = require('./generate');
      await generate(projectRoot, { handoff: true, quiet: true });
    }
  } catch {}

  // Output
  if (!message || !message.startsWith('auto:')) {
    console.log(chalk.bold('\n⚡ Checkpoint saved\n'));
    console.log(chalk.dim('  Time:     ') + chalk.white(now));
    console.log(chalk.dim('  Message:  ') + chalk.white(message || 'manual checkpoint'));
    if (aiTool) console.log(chalk.dim('  AI tool:  ') + chalk.white(aiTool));
    if (gitInfo.git_branch) console.log(chalk.dim('  Branch:   ') + chalk.white(gitInfo.git_branch));
    if (gitInfo.files_changed?.length) {
      console.log(chalk.dim('  Changed:  ') + chalk.white(`${gitInfo.files_changed.length} files`));
    }
    console.log(chalk.dim('  History:  ') + chalk.green(historyFile));
    console.log(chalk.dim('  Handoff:  ') + chalk.green('.relay/HANDOFF.md updated'));
    console.log();
  }

  return checkpointData;
}

function getConfig(projectRoot) {
  const fs = require('fs');
  const path = require('path');
  const configPath = path.join(projectRoot, '.relay', 'config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return { auto_generate_handoff: true };
  }
}

module.exports = { checkpoint };
