const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function isTeamMode(projectRoot) {
  return readTeamConfig(projectRoot).enabled || process.env.MINDSWAP_TEAM === '1';
}

function readTeamConfig(projectRoot) {
  const configPath = path.join(projectRoot, '.mindswap', 'team.json');
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      enabled: data.enabled !== false,
      name: data.name || null,
      shared_memory: data.shared_memory !== false,
    };
  } catch {
    return { enabled: false, name: null, shared_memory: false };
  }
}

function getAuthorIdentity(projectRoot) {
  const name = gitConfig(projectRoot, 'user.name') || process.env.GIT_AUTHOR_NAME || process.env.USER || 'unknown';
  const email = gitConfig(projectRoot, 'user.email') || process.env.GIT_AUTHOR_EMAIL || null;
  return email ? `${name} <${email}>` : name;
}

function annotateHistoryEntry(projectRoot, entry) {
  const teamMode = isTeamMode(projectRoot);
  return {
    ...entry,
    author: entry.author || getAuthorIdentity(projectRoot),
    team_mode: entry.team_mode ?? teamMode,
  };
}

function formatTeamHistory(history = []) {
  if (history.length === 0) return 'No recent team handoffs recorded.';

  return history
    .slice(-5)
    .map(entry => {
      const author = entry.author ? ` — ${entry.author}` : '';
      const mode = entry.team_mode ? ' [shared]' : '';
      return `- **${entry.timestamp || 'unknown'}**${author}${mode}: ${entry.message || 'updated context'}`;
    })
    .join('\n');
}

function teamSection(projectRoot, history = []) {
  if (!isTeamMode(projectRoot)) return '';
  const config = readTeamConfig(projectRoot);
  const sharedMemory = config.shared_memory || process.env.MINDSWAP_TEAM === '1';
  const lines = [];
  lines.push('## Team mode');
  lines.push(`- **Enabled**: yes`);
  if (config.name) lines.push(`- **Workspace**: ${config.name}`);
  lines.push(`- **Author**: ${getAuthorIdentity(projectRoot)}`);
  lines.push(`- **Shared memory**: ${sharedMemory ? 'on' : 'off'}`);
  lines.push('');
  lines.push('## Team history');
  lines.push(formatTeamHistory(history));
  return lines.join('\n');
}

function gitConfig(projectRoot, key) {
  try {
    return execSync(`git config --get ${key}`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim() || null;
  } catch {
    return null;
  }
}

module.exports = {
  isTeamMode,
  readTeamConfig,
  getAuthorIdentity,
  annotateHistoryEntry,
  formatTeamHistory,
  teamSection,
};
