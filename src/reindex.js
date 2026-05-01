const chalk = require('chalk');
const { rebuildSearchIndex, isSqliteAvailable } = require('./index-store');

async function reindex(projectRoot, opts = {}) {
  const report = rebuildSearchIndex(projectRoot, opts);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  console.log(chalk.bold('\n⚡ Reindex\n'));
  if (!isSqliteAvailable()) {
    console.log(chalk.yellow('  SQLite indexing is not available in this Node.js runtime.'));
    console.log();
    return report;
  }

  console.log(chalk.green(`  Indexed ${report.indexed} searchable record${report.indexed === 1 ? '' : 's'}`));
  console.log(chalk.dim(`  Scope: ${report.scope}`));
  console.log(chalk.dim(`  DB: ${report.db_path}`));
  console.log();
  return report;
}

module.exports = {
  reindex,
};
