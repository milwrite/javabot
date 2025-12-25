#!/usr/bin/env node

// scripts/push-changes.js
// Push a set of local files to GitHub as a single commit via GitHub API

require('dotenv').config({ override: true });
const fs = require('fs').promises;
const path = require('path');
const { pushMultipleFiles } = require('../services/gitHelper');

async function main() {
  const required = ['GITHUB_TOKEN', 'GITHUB_REPO_OWNER', 'GITHUB_REPO_NAME'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}. Cannot push.`);
    process.exit(1);
  }

  const targetFiles = [
    'services/filesystem.js',
    'services/requestClassifier.js',
    'index.js',
    'scripts/query-edit-logs.js'
  ];

  const files = [];
  for (const rel of targetFiles) {
    const abs = path.join(process.cwd(), rel);
    try {
      const content = await fs.readFile(abs, 'utf8');
      files.push({ path: rel, content });
    } catch (e) {
      console.error(`Failed to read ${rel}: ${e.message}`);
      process.exit(1);
    }
  }

  const message = process.argv.slice(2).join(' ').trim() || 'feat: anchor-range edits, classifier routing, and edit telemetry';
  try {
    const sha = await pushMultipleFiles(files, message, 'main');
    console.log(JSON.stringify({ pushed: true, sha }, null, 2));
  } catch (e) {
    console.error('Push failed:', e.message);
    process.exit(2);
  }
}

main();

