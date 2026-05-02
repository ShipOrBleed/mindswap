const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, writeState, getDefaultState } = require('../src/state');
const { appendMemoryItem } = require('../src/memory');

let dir;
let globalDir;

function setup() {
  dir = createTempProject('mcp-stdio-test');
  ensureDataDir(dir);
  globalDir = path.join(os.homedir(), '.mindswap');
  try { fs.rmSync(globalDir, { recursive: true, force: true }); } catch {}

  const state = getDefaultState();
  state.project = {
    name: 'stdio-mcp-app',
    language: 'javascript',
    framework: 'Express',
    tech_stack: ['node.js', 'express'],
    package_manager: 'npm',
  };
  state.current_task = {
    description: 'verify stdio MCP',
    status: 'in_progress',
    blocker: null,
    next_steps: ['call every tool'],
    started_at: '2026-05-01T00:00:00.000Z',
  };
  writeState(dir, state);

  appendMemoryItem(dir, {
    type: 'question',
    tag: 'stdio',
    message: 'Does stdio MCP expose every tool?',
  });
}

function teardown() {
  cleanup(dir);
  try { fs.rmSync(globalDir, { recursive: true, force: true }); } catch {}
}

exports.test_mcp_stdio_lists_and_calls_all_tools = async () => {
  setup();
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['/Users/zopdev/mindswap/bin/mindswap.js', 'mcp'],
    cwd: dir,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'mindswap-stdio-test', version: '1.0.0' }, { capabilities: {} });

  try {
    await client.connect(transport);

    const tools = await client.listTools();
    const toolNames = tools.tools.map(tool => tool.name).sort();
    assert.deepStrictEqual(toolNames, [
      'mindswap_get_context',
      'mindswap_memory',
      'mindswap_save_context',
      'mindswap_search',
    ]);

    const context = await client.callTool({
      name: 'mindswap_get_context',
      arguments: { focus: 'all', compact: true },
    });
    assert.ok(context.content[0].text.includes('stdio-mcp-app'));

    const search = await client.callTool({
      name: 'mindswap_search',
      arguments: { query: 'stdio', type: 'all', scope: 'repo' },
    });
    assert.ok(search.content[0].text.includes('result(s)'));

    const memory = await client.callTool({
      name: 'mindswap_memory',
      arguments: { action: 'list', type: 'question', json: true },
    });
    assert.ok(memory.content[0].text.includes('Does stdio MCP expose every tool?'));

    const save = await client.callTool({
      name: 'mindswap_save_context',
      arguments: {
        summary: 'Ran stdio MCP smoke test',
        next_steps: ['Verify all tool invocations'],
      },
    });
    assert.ok(save.content[0].text.toLowerCase().includes('saved'));

    const prompts = await client.listPrompts();
    assert.ok(prompts.prompts.some(prompt => prompt.name === 'mindswap_start_work'));

    const prompt = await client.getPrompt({
      name: 'mindswap_resume_work',
      arguments: { compact: 'true' },
    });
    assert.ok(prompt.messages[0].content.text.includes('Resume this workstream'));

    const resources = await client.listResources();
    assert.ok(resources.resources.some(resource => resource.uri === 'mindswap://context/current'));

    const resource = await client.readResource({ uri: 'mindswap://state/current' });
    assert.ok(resource.contents[0].text.includes('stdio-mcp-app'));
  } finally {
    await client.close();
    await transport.close();
    teardown();
  }
};
