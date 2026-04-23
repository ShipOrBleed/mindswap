const fs = require('fs');
const path = require('path');

/**
 * Generate an AI-optimized narrative summary from project state.
 * This is the core differentiator — instead of dumping raw data,
 * produce a paragraph that any AI can parse instantly.
 */
function buildNarrative(state, liveData) {
  const parts = [];
  const proj = state.project;
  const task = state.current_task;
  const cp = state.last_checkpoint;

  // ─── Opening: Project identity ───
  const stackParts = [proj.language, proj.framework].filter(Boolean);
  const stackStr = stackParts.length > 0 ? ` (${stackParts.join('/')})` : '';
  parts.push(`Project: **${proj.name}**${stackStr}.`);

  // ─── Branch context ───
  if (liveData.branch && liveData.branch !== 'main' && liveData.branch !== 'master') {
    parts.push(`On branch \`${liveData.branch}\`.`);
  }

  // ─── Current task ───
  if (task.description && task.status !== 'idle') {
    const statusMap = {
      in_progress: 'Currently working on',
      blocked: 'BLOCKED on',
      paused: 'Paused on',
    };
    const prefix = statusMap[task.status] || 'Working on';
    parts.push(`${prefix}: **${task.description}**.`);

    if (task.blocker) {
      parts.push(`Blocker: ${task.blocker}.`);
    }
    if (task.next_steps?.length) {
      parts.push(`Next steps: ${task.next_steps.join(', ')}.`);
    }
  } else {
    parts.push('No active task — idle.');
  }

  // ─── What was done (from commits + diff analysis) ───
  const workDone = describeWorkDone(liveData);
  if (workDone) {
    parts.push(workDone);
  }

  // ─── Recent native AI session ───
  const sessionBrief = describeSessionFindings(liveData.nativeSessions);
  if (sessionBrief) {
    parts.push(sessionBrief);
  }

  // ─── Test/build status ───
  if (state.test_status) {
    const ts = state.test_status;
    if (ts.passed != null) {
      const icon = ts.failed > 0 ? 'FAILING' : 'passing';
      parts.push(`Tests: ${ts.passed} ${icon}${ts.failed > 0 ? `, ${ts.failed} failed` : ''}.`);
    } else if (ts.status) {
      parts.push(`Tests: ${ts.status}.`);
    }
  }

  // ─── Key decisions (condensed) ───
  if (liveData.decisions?.length > 0) {
    const condensed = liveData.decisions.slice(-5).map(d => {
      // Strip timestamp and tag, keep just the decision text
      return d.replace(/^\[.*?\]\s*\[.*?\]\s*/, '').trim();
    });
    parts.push(`Key decisions: ${condensed.join('; ')}.`);
  }

  // ─── Changed files summary (grouped, not listed) ───
  if (liveData.changedFiles?.length > 0) {
    const fileSummary = summarizeFiles(liveData.changedFiles);
    if (fileSummary) {
      parts.push(fileSummary);
    }
  }

  // ─── AI tool used last ───
  if (cp.ai_tool) {
    parts.push(`Last AI tool: ${cp.ai_tool}.`);
  }

  return parts.join(' ');
}

/**
 * Build a compact narrative — absolute minimum tokens, maximum information.
 * For use in token-constrained contexts.
 */
function buildCompactNarrative(state, liveData) {
  const proj = state.project;
  const task = state.current_task;
  const lines = [];

  // One-line project identity
  lines.push(`${proj.name} | ${[proj.language, proj.framework].filter(Boolean).join('/')} | ${liveData.branch || 'main'}`);

  // Task
  if (task.description && task.status !== 'idle') {
    let taskLine = `TASK: ${task.description} [${task.status}]`;
    if (task.blocker) taskLine += ` BLOCKED: ${task.blocker}`;
    if (task.next_steps?.length) taskLine += ` NEXT: ${task.next_steps.join(', ')}`;
    lines.push(taskLine);
  }

  // Tests
  if (state.test_status?.passed != null) {
    const ts = state.test_status;
    lines.push(`TESTS: ${ts.passed}/${ts.total || ts.passed + (ts.failed || 0)} ${ts.failed > 0 ? 'FAIL' : 'OK'}`);
  }

  // Recent commits (just messages, no hashes)
  if (liveData.recentCommits?.length > 0) {
    lines.push(`RECENT: ${liveData.recentCommits.slice(0, 3).map(c => c.message).join(' | ')}`);
  }

  const sessionBrief = describeSessionFindings(liveData.nativeSessions);
  if (sessionBrief) {
    lines.push(`SESSION: ${sessionBrief}`);
  }

  // Decisions (stripped, semicolon-separated)
  if (liveData.decisions?.length > 0) {
    const stripped = liveData.decisions.slice(-5).map(d =>
      d.replace(/^\[.*?\]\s*\[.*?\]\s*/, '').trim()
    );
    lines.push(`DECISIONS: ${stripped.join('; ')}`);
  }

  // Changed files (just count + areas)
  if (liveData.changedFiles?.length > 0) {
    const areas = detectAreas(liveData.changedFiles);
    lines.push(`CHANGED: ${liveData.changedFiles.length} files${areas.length > 0 ? ` (${areas.join(', ')})` : ''}`);
  }

  return lines.join('\n');
}

/**
 * Describe what work was done based on commits and file changes.
 */
function describeWorkDone(liveData) {
  const parts = [];

  // From recent commits — extract meaningful work descriptions
  if (liveData.recentCommits?.length > 0) {
    const meaningful = liveData.recentCommits
      .filter(c => !c.message.startsWith('Merge') && !c.message.startsWith('auto:'))
      .slice(0, 3);

    if (meaningful.length > 0) {
      parts.push(`Recent work: ${meaningful.map(c => c.message).join('; ')}.`);
    }
  }

  // From file changes — detect patterns
  if (liveData.changedFiles?.length > 0) {
    const patterns = detectWorkPatterns(liveData.changedFiles);
    if (patterns.length > 0) {
      parts.push(`Changes involve: ${patterns.join(', ')}.`);
    }
  }

  return parts.join(' ') || null;
}

/**
 * Detect work patterns from changed file paths.
 */
function detectWorkPatterns(changedFiles) {
  const patterns = new Set();
  const fileNames = changedFiles.map(f => (f.file || f).toLowerCase());

  const patternMap = [
    { keywords: ['migration', 'schema', 'migrate'], label: 'database migrations' },
    { keywords: ['test', 'spec', '__test__', '.test.'], label: 'tests' },
    { keywords: ['api', 'route', 'handler', 'controller', 'endpoint'], label: 'API endpoints' },
    { keywords: ['auth', 'login', 'signup', 'session', 'jwt', 'oauth'], label: 'authentication' },
    { keywords: ['component', 'page', 'layout', 'view', '.tsx', '.jsx', '.vue', '.svelte'], label: 'UI components' },
    { keywords: ['style', 'css', 'scss', 'tailwind', 'theme'], label: 'styling' },
    { keywords: ['config', '.env', 'setting', 'yaml', 'toml'], label: 'configuration' },
    { keywords: ['middleware', 'interceptor', 'filter', 'guard'], label: 'middleware' },
    { keywords: ['model', 'entity', 'schema', 'type', 'interface'], label: 'data models' },
    { keywords: ['service', 'usecase', 'interactor'], label: 'business logic' },
    { keywords: ['store', 'repository', 'dao', 'query'], label: 'data access layer' },
    { keywords: ['util', 'helper', 'lib', 'common', 'shared'], label: 'utilities' },
    { keywords: ['docker', 'dockerfile', 'compose', 'k8s', 'helm'], label: 'infrastructure' },
    { keywords: ['ci', 'workflow', 'pipeline', 'deploy', 'github/workflows'], label: 'CI/CD' },
    { keywords: ['readme', 'doc', 'changelog', 'contributing'], label: 'documentation' },
    { keywords: ['package.json', 'go.mod', 'cargo.toml', 'requirements.txt', 'gemfile'], label: 'dependencies' },
    { keywords: ['webhook', 'event', 'listener', 'subscriber', 'queue'], label: 'event handling' },
    { keywords: ['email', 'notification', 'alert', 'sms'], label: 'notifications' },
    { keywords: ['payment', 'billing', 'stripe', 'invoice', 'subscription'], label: 'payments' },
    { keywords: ['upload', 'storage', 'file', 's3', 'bucket', 'blob'], label: 'file storage' },
  ];

  for (const file of fileNames) {
    for (const pattern of patternMap) {
      if (pattern.keywords.some(kw => file.includes(kw))) {
        patterns.add(pattern.label);
      }
    }
  }

  return [...patterns].slice(0, 5); // Max 5 patterns
}

/**
 * Detect broad work areas from changed files.
 */
function detectAreas(changedFiles) {
  const areas = new Set();
  for (const f of changedFiles) {
    const file = (f.file || f).toLowerCase();
    if (file.includes('src/') || file.includes('lib/') || file.includes('app/')) areas.add('source');
    if (file.includes('test') || file.includes('spec')) areas.add('tests');
    if (file.includes('config') || file.includes('.env')) areas.add('config');
    if (file.includes('doc') || file.includes('readme')) areas.add('docs');
    if (file.includes('migration')) areas.add('migrations');
    if (file.includes('style') || file.includes('css')) areas.add('styles');
  }
  return [...areas].slice(0, 4);
}

/**
 * Summarize changed files into a human-readable sentence.
 */
function summarizeFiles(changedFiles) {
  const total = changedFiles.length;
  if (total === 0) return null;

  const byStatus = {};
  for (const f of changedFiles) {
    const status = f.status || 'changed';
    byStatus[status] = (byStatus[status] || 0) + 1;
  }

  const parts = [];
  if (byStatus.new) parts.push(`${byStatus.new} new`);
  if (byStatus.modified) parts.push(`${byStatus.modified} modified`);
  if (byStatus.deleted) parts.push(`${byStatus.deleted} deleted`);

  const areas = detectAreas(changedFiles);
  const areaStr = areas.length > 0 ? ` in ${areas.join(', ')}` : '';

  return `${total} uncommitted files (${parts.join(', ')}${areaStr}).`;
}

function describeSessionFindings(sessions) {
  if (!sessions || sessions.length === 0) return null;

  const session = sessions[0];
  const parts = [];
  parts.push(`${session.tool}${session.timestamp ? ` @ ${session.timestamp}` : ''}`);
  if (session.summary) parts.push(session.summary);
  if (session.blockers?.length > 0) parts.push(`blocker: ${session.blockers[0]}`);
  if (session.failures?.length > 0) parts.push(`failure: ${session.failures[0]}`);
  if (session.fileEdits?.length > 0) {
    parts.push(`files: ${session.fileEdits.slice(0, 3).map(f => path.basename(f)).join(', ')}`);
  }

  return parts.join(' — ');
}

/**
 * Calculate context quality score (0-100).
 * Tells user how complete their handoff context is.
 */
function calculateQualityScore(state, liveData) {
  let score = 0;
  const missing = [];
  const present = [];

  // Project detection (15 points)
  if (state.project?.language) { score += 5; present.push('language detected'); }
  else missing.push('language not detected');
  if (state.project?.framework) { score += 5; present.push('framework detected'); }
  if (state.project?.tech_stack?.length > 2) { score += 5; present.push('tech stack mapped'); }

  // Current task (25 points)
  if (state.current_task?.description && state.current_task.status !== 'idle') {
    score += 15;
    present.push('active task set');
    if (state.current_task.next_steps?.length > 0) { score += 5; present.push('next steps defined'); }
    else missing.push('no next steps defined');
    if (state.current_task.blocker) { score += 5; present.push('blocker documented'); }
  } else {
    missing.push('no active task — set one with: mindswap cp "your task"');
  }

  // Git state (15 points)
  if (liveData.branch) { score += 5; present.push('branch tracked'); }
  if (liveData.recentCommits?.length > 0) { score += 5; present.push('commit history available'); }
  if (liveData.changedFiles?.length >= 0) { score += 5; present.push('file changes tracked'); }

  // Decisions (20 points)
  const decisionCount = liveData.decisions?.length || 0;
  if (decisionCount >= 3) { score += 20; present.push(`${decisionCount} decisions logged`); }
  else if (decisionCount >= 1) { score += 10; present.push(`${decisionCount} decision(s)`); missing.push('log more decisions for better context'); }
  else { missing.push('no decisions logged — use: mindswap log "chose X because Y"'); }

  // Test status (10 points)
  if (state.test_status?.passed != null) { score += 10; present.push('test status captured'); }
  else missing.push('no test status — use: mindswap --check');

  // Checkpoint recency (10 points)
  if (state.last_checkpoint?.timestamp) {
    const ageHours = (Date.now() - new Date(state.last_checkpoint.timestamp).getTime()) / 3600000;
    if (ageHours < 1) { score += 10; present.push('checkpoint is fresh'); }
    else if (ageHours < 24) { score += 5; present.push('checkpoint from today'); }
    else { score += 2; missing.push('checkpoint is stale — run: mindswap'); }
  } else {
    missing.push('no checkpoint saved yet — run: mindswap');
  }

  // History depth (5 points)
  if (liveData.history?.length >= 3) { score += 5; present.push('session history available'); }

  return {
    score: Math.min(score, 100),
    grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F',
    present,
    missing,
  };
}

module.exports = {
  buildNarrative,
  buildCompactNarrative,
  describeWorkDone,
  describeSessionFindings,
  detectWorkPatterns,
  calculateQualityScore,
  summarizeFiles,
};
