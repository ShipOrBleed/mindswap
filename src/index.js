const { init } = require('./init');
const { checkpoint } = require('./checkpoint');
const { status } = require('./status');
const { generate } = require('./generate');
const { watch } = require('./watch');
const { log } = require('./decisions');
const { done, reset } = require('./lifecycle');
const { readState, writeState, updateState, getHistory } = require('./state');
const { detectProject } = require('./detect');
const { detectAITool } = require('./detect-ai');
const { isGitRepo, getCurrentBranch, getAllChangedFiles } = require('./git');

module.exports = {
  init,
  checkpoint,
  status,
  generate,
  watch,
  log,
  done,
  reset,
  readState,
  writeState,
  updateState,
  getHistory,
  detectProject,
  detectAITool,
  isGitRepo,
  getCurrentBranch,
  getAllChangedFiles,
};
