const assert = require('assert');
const http = require('http');
const { createTempProject, cleanup } = require('./helpers');
const { ensureDataDir, writeState, getDefaultState } = require('../src/state');
const { appendMemoryItem } = require('../src/memory');
const { startMCPHttpServer } = require('../src/mcp-server');

let dir;

function setup() {
  dir = createTempProject('mcp-http-test');
  ensureDataDir(dir);

  const state = getDefaultState();
  state.project = {
    name: 'remote-mcp-app',
    language: 'typescript',
    framework: 'Express',
    tech_stack: ['node.js', 'express'],
    package_manager: 'npm',
  };
  state.current_task = {
    description: 'ship remote MCP transport',
    status: 'in_progress',
    blocker: 'waiting on browser client validation',
    next_steps: ['validate streamable HTTP transport'],
    started_at: '2026-04-24T00:00:00.000Z',
  };
  writeState(dir, state);

  appendMemoryItem(dir, {
    type: 'question',
    tag: 'transport',
    message: 'Should this be stateless by default?',
  });
}

function teardown() {
  cleanup(dir);
}

function requestJson(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2024-11-05',
        ...headers,
      },
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: raw }));
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

exports.test_mcp_http_serve_tools_prompts_resources_and_auth = async () => {
  setup();
  const server = await startMCPHttpServer({
    projectRoot: dir,
    host: '127.0.0.1',
    port: 0,
    path: '/mcp',
    origin: '*',
  });

  try {
    const initialize = await requestJson(server.url, {
      method: 'POST',
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'http-test', version: '1.0.0' },
        },
      },
    });
    assert.strictEqual(initialize.statusCode, 200);
    const sessionId = initialize.headers['mcp-session-id'];
    assert.ok(sessionId, 'initialize should return a session id');
    const initializePayload = JSON.parse(initialize.body);
    assert.ok(initializePayload.result.serverInfo.name.includes('mindswap'));

    const sessionHeaders = {
      'mcp-session-id': sessionId,
    };

    const initialized = await requestJson(server.url, {
      method: 'POST',
      headers: sessionHeaders,
      body: {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {},
      },
    });
    assert.ok(initialized.statusCode === 200 || initialized.statusCode === 202);

    const tools = await requestJson(server.url, {
      method: 'POST',
      headers: sessionHeaders,
      body: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      },
    });
    const toolsPayload = JSON.parse(tools.body);
    assert.ok(toolsPayload.result.tools.some(tool => tool.name === 'mindswap_memory'));
    const searchTool = toolsPayload.result.tools.find(tool => tool.name === 'mindswap_search');
    const memoryTool = toolsPayload.result.tools.find(tool => tool.name === 'mindswap_memory');
    assert.deepStrictEqual(searchTool.inputSchema.properties.scope.enum, ['repo', 'global', 'all']);
    assert.deepStrictEqual(memoryTool.inputSchema.properties.scope.enum, ['repo', 'global', 'all']);
    assert.strictEqual(memoryTool.inputSchema.properties.global.type, 'boolean');

    const prompts = await requestJson(server.url, {
      method: 'POST',
      headers: sessionHeaders,
      body: {
        jsonrpc: '2.0',
        id: 3,
        method: 'prompts/list',
        params: {},
      },
    });
    const promptsPayload = JSON.parse(prompts.body);
    assert.ok(promptsPayload.result.prompts.some(prompt => prompt.name === 'mindswap_resume_work'));

    const resources = await requestJson(server.url, {
      method: 'POST',
      headers: sessionHeaders,
      body: {
        jsonrpc: '2.0',
        id: 4,
        method: 'resources/list',
        params: {},
      },
    });
    const resourcesPayload = JSON.parse(resources.body);
    assert.ok(resourcesPayload.result.resources.some(resource => resource.uri === 'mindswap://memory/current'));

    const memory = await requestJson(server.url, {
      method: 'POST',
      headers: sessionHeaders,
      body: {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'mindswap_memory',
          arguments: {
            action: 'list',
            type: 'question',
            json: true,
          },
        },
      },
    });
    const memoryPayload = JSON.parse(memory.body);
    assert.ok(memoryPayload.result.content[0].text.includes('Should this be stateless by default?'));

    const prompt = await requestJson(server.url, {
      method: 'POST',
      headers: sessionHeaders,
      body: {
        jsonrpc: '2.0',
        id: 6,
        method: 'prompts/get',
        params: {
          name: 'mindswap_resume_work',
          arguments: { compact: 'true' },
        },
      },
    });
    const promptPayload = JSON.parse(prompt.body);
    assert.ok(promptPayload.result.messages[0].content.text.includes('Resume this workstream from the current repo state.'));

    const resource = await requestJson(server.url, {
      method: 'POST',
      headers: sessionHeaders,
      body: {
        jsonrpc: '2.0',
        id: 7,
        method: 'resources/read',
        params: {
          uri: 'mindswap://context/current',
        },
      },
    });
    const resourcePayload = JSON.parse(resource.body);
    assert.ok(resourcePayload.result.contents[0].text.includes('remote-mcp-app'));

    const protectedServer = await startMCPHttpServer({
      projectRoot: dir,
      host: '127.0.0.1',
      port: 0,
      path: '/mcp',
      token: 'secret-token',
      origin: '*',
    });

    try {
      const unauthorized = await requestJson(protectedServer.url, {
        method: 'POST',
        body: {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'unauthenticated', version: '1.0.0' },
          },
        },
      });
      assert.strictEqual(unauthorized.statusCode, 401);

      const authorized = await requestJson(protectedServer.url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret-token',
        },
        body: {
          jsonrpc: '2.0',
          id: 2,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'authenticated', version: '1.0.0' },
          },
        },
      });
      assert.strictEqual(authorized.statusCode, 200);
      assert.ok(authorized.body.includes('jsonrpc'));
    } finally {
      await protectedServer.close();
    }
  } finally {
    await server.close();
    teardown();
  }
};
