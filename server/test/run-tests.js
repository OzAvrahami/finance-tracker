const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

require('./setup');

const testRoot = __dirname;

function findCanonicalTests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return findCanonicalTests(entryPath);
      if (!entry.isFile()) return [];
      if (!entry.name.endsWith('.test.js')) return [];
      if (entry.name.endsWith('.local.test.js')) return [];
      return [entryPath];
    });
}

const testFiles = findCanonicalTests(testRoot).sort((left, right) => (
  left.localeCompare(right, 'en')
));

if (testFiles.length === 0) {
  console.error('No canonical server tests were found.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: path.join(__dirname, '..'),
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Unable to start the server test runner: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);

