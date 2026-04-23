const { init } = require('./init');
const { checkpoint } = require('./checkpoint');
const { status } = require('./status');
const { generate } = require('./generate');
const { watch } = require('./watch');
const { log } = require('./decisions');
const { done, reset } = require('./lifecycle');
const { switchTool } = require('./switch');
const { summary } = require('./summary');
const { resume } = require('./resume');
const { ask } = require('./ask');
const { contracts } = require('./contracts');
const { sync } = require('./sync');
const { save } = require('./save');
const { readState, writeState, updateState, getHistory } = require('./state');
const { detectProject } = require('./detect');
const { detectAITool } = require('./detect-ai');
const { isGitRepo, getCurrentBranch, getAllChangedFiles } = require('./git');
const { checkConflicts, findAllConflicts, checkDepsVsDecisions } = require('./conflicts');
const { runChecks, detectLastStatus } = require('./build-test');
const { buildNarrative, buildCompactNarrative, calculateQualityScore } = require('./narrative');
const { importSessions } = require('./session-import');
const { scanForSecrets, redactSecrets } = require('./secrets');
const { detectMonorepo } = require('./monorepo');
const { parseNativeSessions } = require('./session-parser');
const { analyzeGuardrails } = require('./guardrails');
const { pr } = require('./pr');
const { readMemory, appendMemoryItem, getMemoryItems } = require('./memory');
const { doctor } = require('./doctor');

module.exports = {
  init,
  checkpoint,
  status,
  generate,
  watch,
  log,
  done,
  reset,
  save,
  switchTool,
  summary,
  resume,
  ask,
  contracts,
  sync,
  readState,
  writeState,
  updateState,
  getHistory,
  detectProject,
  detectAITool,
  isGitRepo,
  getCurrentBranch,
  getAllChangedFiles,
  checkConflicts,
  findAllConflicts,
  checkDepsVsDecisions,
  runChecks,
  detectLastStatus,
  buildNarrative,
  buildCompactNarrative,
  calculateQualityScore,
  importSessions,
  scanForSecrets,
  redactSecrets,
  detectMonorepo,
  parseNativeSessions,
  analyzeGuardrails,
  pr,
  readMemory,
  appendMemoryItem,
  getMemoryItems,
  doctor,
};
