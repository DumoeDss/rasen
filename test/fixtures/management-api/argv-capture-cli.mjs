#!/usr/bin/env node
const argv = process.argv.slice(2);
const name = argv[2];

process.stdout.write(JSON.stringify({
  change: {
    id: name,
    path: JSON.stringify({ argv, cwd: process.cwd() }),
    schema: 'spec-driven',
  },
}));
