const fs = require('fs');
const chalk = require('chalk');
const { getDataDir, readState } = require('./state');
const { searchContext } = require('./mcp-server');

async function ask(projectRoot, question, opts = {}) {
  const dataDir = getDataDir(projectRoot);
  if (!fs.existsSync(dataDir)) {
    console.log(chalk.yellow('\nmindswap not initialized. Run: npx mindswap init\n'));
    return;
  }

  const query = normalizeQuestion(question);
  if (!query) {
    console.log(chalk.yellow('\nPlease provide a question to ask.\n'));
    return;
  }

  const state = readState(projectRoot);
  const search = searchContext(projectRoot, query, 'all');
  const results = parseSearchResults(search?.content?.[0]?.text || '');
  const payload = buildAnswerPayload(query, results, state);

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(chalk.bold('\n⚡ Ask\n'));
  console.log(chalk.white(`Question: ${query}`));
  console.log(chalk.cyan(`Answer: ${payload.answer}`));

  if (payload.sources.length > 0) {
    console.log(chalk.bold('\n  Sources'));
    for (const source of payload.sources.slice(0, 5)) {
      console.log(chalk.dim(`  • [${source.type}] (${source.score}) ${source.content}`));
    }
  }

  if (payload.next_step) {
    console.log(chalk.bold('\n  Next step'));
    console.log(chalk.white(`  ${payload.next_step}`));
  }

  console.log();
}

function normalizeQuestion(question) {
  if (Array.isArray(question)) return question.join(' ').trim();
  return String(question || '').trim();
}

function parseSearchResults(text) {
  const lines = String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const results = [];
  for (const line of lines) {
    const match = line.match(/^\[(.+?)\]\s+\((\d+)\)\s+(.+)$/);
    if (!match) continue;
    results.push({
      type: match[1],
      score: Number(match[2]),
      content: match[3],
    });
  }
  return results;
}

function buildAnswerPayload(question, results, state) {
  const top = results[0] || null;
  const questionLower = question.toLowerCase();
  const task = state.current_task || {};

  let answer = 'No strong match found in the project context yet.';
  if (top) {
    if (top.type.includes('decision')) {
      answer = `The strongest recorded decision is: ${stripDecisionPrefix(top.content)}.`;
    } else if (top.type === 'blocker' || top.content.toLowerCase().includes('blocker')) {
      answer = `The active blocker appears to be: ${top.content}.`;
    } else if (questionLower.startsWith('why')) {
      answer = `The best explanation from project memory is: ${stripContextPrefix(top.content)}.`;
    } else if (questionLower.startsWith('what') || questionLower.startsWith('how')) {
      answer = `The most relevant context says: ${stripContextPrefix(top.content)}.`;
    } else {
      answer = stripContextPrefix(top.content);
    }
  }

  if (task.description && task.status !== 'idle' && !answer.includes(task.description)) {
    answer += ` Current task: ${task.description}.`;
  }

  const next_step = top
    ? `Review the cited source lines in the handoff and, if needed, run \`npx mindswap search "${shortenQuestion(question)}"\` for a narrower pass.`
    : 'Run `npx mindswap save` or log more context to improve future answers.';

  return {
    question,
    answer,
    next_step,
    sources: results.slice(0, 5),
  };
}

function stripDecisionPrefix(content) {
  return String(content || '').replace(/^\[.*?\]\s*\[.*?\]\s*/, '').trim();
}

function stripContextPrefix(content) {
  return String(content || '').replace(/^(Current task:|Current blocker:|Tech stack includes:)\s*/i, '').trim();
}

function shortenQuestion(question) {
  return String(question || '').trim().slice(0, 80);
}

module.exports = {
  ask,
  parseSearchResults,
  buildAnswerPayload,
  normalizeQuestion,
};
