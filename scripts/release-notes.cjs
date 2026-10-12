/**
 * Print the CHANGELOG.md section for one version — the body of its GitHub release.
 *
 * Run: node scripts/release-notes.cjs 1.2.5   (a leading "v" is accepted)
 */
const fs = require('node:fs');
const path = require('node:path');

const version = (process.argv[2] ?? '').replace(/^v/, '');
if (!version) {
  console.error('usage: node scripts/release-notes.cjs <version>');
  process.exit(1);
}

const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf-8');
const lines = changelog.split('\n');
const start = lines.findIndex((l) => l.trim() === `## ${version}`);
if (start < 0) {
  console.error(`CHANGELOG.md has no "## ${version}" section`);
  process.exit(1);
}
const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
console.log(lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim());
