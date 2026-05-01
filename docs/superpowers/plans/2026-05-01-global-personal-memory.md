# Global Personal Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class global personal memory and scoped recall on top of the current repo-centered MindSwap CLI and MCP memory model.

**Architecture:** Reuse the existing file-based memory format and introduce a small scope-resolution layer that can target repo memory, global memory, or both. Keep repo defaults stable, add explicit global writes, and extend ask/search with cross-scope reads before introducing any local indexing layer.

**Tech Stack:** Node.js, Commander CLI, JSON file storage, existing memory/state/search modules, Node test runner in `test/run.js`

---

### Task 1: Add scope resolution helpers

**Files:**
- Create: `src/scope.js`
- Test: `test/scope.test.js`

- [ ] **Step 1: Write the failing test**

```js
const assert = require('assert');
const os = require('os');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { resolveMemoryRoots, getGlobalProjectRoot } = require('../src/scope');

let dir;

exports.beforeEach = () => {
  dir = createTempProject('scope-test');
};

exports.afterEach = () => {
  cleanup(dir);
};

exports.test_getGlobalProjectRoot_uses_home_directory = () => {
  assert.strictEqual(getGlobalProjectRoot(), os.homedir());
};

exports.test_resolveMemoryRoots_returns_repo_root_by_default_inside_repo = () => {
  const roots = resolveMemoryRoots(dir, { scope: 'repo' });
  assert.deepStrictEqual(roots, [dir]);
};

exports.test_resolveMemoryRoots_supports_global_scope = () => {
  const roots = resolveMemoryRoots(dir, { scope: 'global' });
  assert.deepStrictEqual(roots, [os.homedir()]);
};

exports.test_resolveMemoryRoots_supports_all_scope = () => {
  const roots = resolveMemoryRoots(dir, { scope: 'all' });
  assert.deepStrictEqual(roots, [dir, os.homedir()]);
};
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/run.js scope`
Expected: FAIL with module or function not found errors for `../src/scope`

- [ ] **Step 3: Write minimal implementation**

```js
const os = require('os');

function getGlobalProjectRoot() {
  return os.homedir();
}

function resolveMemoryRoots(projectRoot, opts = {}) {
  const scope = opts.scope || 'repo';
  if (scope === 'global') return [getGlobalProjectRoot()];
  if (scope === 'all') return [projectRoot, getGlobalProjectRoot()];
  return [projectRoot];
}

module.exports = {
  getGlobalProjectRoot,
  resolveMemoryRoots,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/run.js scope`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scope.js test/scope.test.js
git commit -m "feat: add memory scope resolution helpers"
```

### Task 2: Add global-scoped memory CRUD

**Files:**
- Modify: `src/memory.js`
- Modify: `src/mcp-server.js`
- Modify: `bin/mindswap.js`
- Test: `test/memory-global.test.js`

- [ ] **Step 1: Write the failing test**

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createTempProject, cleanup } = require('./helpers');
const { manageMemory } = require('../src/mcp-server');
const { readMemory } = require('../src/memory');

let dir;
let globalMemoryPath;

exports.beforeEach = () => {
  dir = createTempProject('memory-global-test');
  globalMemoryPath = path.join(os.homedir(), '.mindswap', 'memory.json');
  try { fs.rmSync(path.join(os.homedir(), '.mindswap'), { recursive: true, force: true }); } catch {}
};

exports.afterEach = () => {
  cleanup(dir);
  try { fs.rmSync(path.join(os.homedir(), '.mindswap'), { recursive: true, force: true }); } catch {}
};

exports.test_manageMemory_add_global_writes_to_home_scope = () => {
  manageMemory(dir, {
    action: 'add',
    type: 'assumption',
    message: 'Prefer concise answers across AI tools',
    scope: 'global',
  });

  assert.ok(fs.existsSync(globalMemoryPath));
  const memory = readMemory(os.homedir());
  assert.ok(memory.items.some(item => item.message.includes('Prefer concise answers')));
};
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/run.js memory-global`
Expected: FAIL because `scope` is ignored and memory is not written to the global path

- [ ] **Step 3: Write minimal implementation**

Implementation requirements:

```js
// In src/mcp-server.js, route list/get/add/update/resolve/archive/delete
// through a resolved scope root before calling memory helpers.

// In bin/mindswap.js add:
// .option('--global', 'Use global personal memory scope')
// .option('--scope <scope>', 'Memory scope: repo, global, all')
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/run.js memory-global`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server.js bin/mindswap.js test/memory-global.test.js
git commit -m "feat: add global-scoped memory crud"
```

### Task 3: Add scoped ask/global recall

**Files:**
- Modify: `src/ask.js`
- Modify: `src/mcp-server.js`
- Modify: `bin/mindswap.js`
- Test: `test/ask-global.test.js`

- [ ] **Step 1: Write the failing test**

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createTempProject, cleanup } = require('./helpers');
const { appendMemoryItem } = require('../src/memory');
const { searchContext } = require('../src/mcp-server');

let dir;

exports.beforeEach = () => {
  dir = createTempProject('ask-global-test');
  try { fs.rmSync(path.join(os.homedir(), '.mindswap'), { recursive: true, force: true }); } catch {}
  appendMemoryItem(os.homedir(), {
    type: 'assumption',
    message: 'Prefer direct explanations across tools',
    tag: 'style',
  });
};

exports.afterEach = () => {
  cleanup(dir);
  try { fs.rmSync(path.join(os.homedir(), '.mindswap'), { recursive: true, force: true }); } catch {}
};

exports.test_searchContext_scope_all_includes_global_memory = () => {
  const result = searchContext(dir, 'direct explanations', 'all', null, { scope: 'all' });
  const text = result.content[0].text;
  assert.ok(text.includes('global:assumption'));
};
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/run.js ask-global`
Expected: FAIL because search only reads repo-scoped context

- [ ] **Step 3: Write minimal implementation**

Implementation requirements:

```js
// Extend searchContext(projectRoot, query, type, snapshot = null, opts = {})
// so it can merge global memory items when opts.scope is "global" or "all".
// Prefix result types with "global:" for global memory lines.

// Extend ask() and CLI options to pass scope through:
// --global => scope global
// --scope all => merged recall
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test/run.js ask-global`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ask.js src/mcp-server.js bin/mindswap.js test/ask-global.test.js
git commit -m "feat: add scoped global recall for ask and search"
```

### Task 4: Verify and document shipped behavior

**Files:**
- Modify: `README.md`
- Test: `test/mcp-server.test.js`

- [ ] **Step 1: Write the failing test**

```js
// Add a test that scoped search preserves repo-first relevance
// when both repo and global memory are present.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/run.js mcp-server`
Expected: FAIL because mixed-scope ranking is not yet asserted

- [ ] **Step 3: Write minimal implementation**

Implementation requirements:

```md
## Global personal memory

- `npx mindswap memory add --global --type assumption "..."`
- `npx mindswap ask --global "..."`
- `npx mindswap ask --scope all "..."`
```
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md test/mcp-server.test.js
git commit -m "docs: explain global personal memory scope"
```
