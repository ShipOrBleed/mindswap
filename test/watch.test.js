const assert = require('assert');
const { startWatchSession, stopWatchSession, getWatchPlan } = require('../src/watch');

exports.test_getWatchPlan_save_mode = () => {
  const plan = getWatchPlan({ save: true, all: true });
  assert.strictEqual(plan.save, true);
  assert.strictEqual(plan.label, 'save + full context refresh');
  assert.deepStrictEqual(plan.generateOpts, { all: true });
};

exports.test_startWatchSession_runs_save_record_and_hook = async () => {
  const calls = [];
  const deps = {
    save: async (projectRoot, opts) => calls.push(['save', projectRoot, opts]),
    resolveTool: (toolName) => toolName ? { key: toolName, description: 'Cursor IDE' } : null,
    inferActiveTool: () => null,
    recordSessionEvent: (projectRoot, event, tool, context) => calls.push(['record', projectRoot, event, tool, context]),
    runSessionHook: (projectRoot, event, tool, context) => {
      calls.push(['hook', projectRoot, event, tool, context]);
      return { ran: true };
    },
  };

  const result = await startWatchSession('/tmp/watch-start', {
    tool: 'cursor',
    message: 'start note',
    check: true,
  }, deps);

  assert.strictEqual(result.tool.key, 'cursor');
  assert.strictEqual(result.saved, true);
  assert.strictEqual(result.hookRan, true);
  assert.deepStrictEqual(calls[0], ['save', '/tmp/watch-start', {
    message: 'start note',
    quiet: true,
    check: true,
  }]);
  assert.strictEqual(calls[1][2], 'session_start');
  assert.strictEqual(calls[2][2], 'session_start');
  assert.strictEqual(calls[2][4].trigger, 'watch-start');
};

exports.test_stopWatchSession_runs_save_record_and_hook = async () => {
  const calls = [];
  const deps = {
    save: async (projectRoot, opts) => calls.push(['save', projectRoot, opts]),
    resolveTool: () => null,
    inferActiveTool: () => ({ key: 'cursor', description: 'Cursor IDE' }),
    recordSessionEvent: (projectRoot, event, tool, context) => calls.push(['record', projectRoot, event, tool, context]),
    runSessionHook: (projectRoot, event, tool, context) => {
      calls.push(['hook', projectRoot, event, tool, context]);
      return { ran: true };
    },
  };

  const result = await stopWatchSession('/tmp/watch-stop', {
    message: 'stop note',
  }, {
    trigger: 'SIGTERM',
  }, deps);

  assert.strictEqual(result.tool.key, 'cursor');
  assert.strictEqual(result.saved, true);
  assert.strictEqual(result.hookRan, true);
  assert.deepStrictEqual(calls[0], ['save', '/tmp/watch-stop', {
    message: 'stop note',
    quiet: true,
    check: false,
  }]);
  assert.strictEqual(calls[1][2], 'session_end');
  assert.strictEqual(calls[1][4].trigger, 'SIGTERM');
  assert.strictEqual(calls[2][2], 'session_end');
  assert.strictEqual(calls[2][4].trigger, 'SIGTERM');
};
