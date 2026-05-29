#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const runTsc = (args = []) => {
  const tscPath = require.resolve('typescript/bin/tsc');
  execFileSync(process.execPath, [tscPath, ...args], { stdio: 'inherit' });
};

console.log('🔨 Building OpenSpec...\n');

// Clean dist directory
if (existsSync('dist')) {
  console.log('Cleaning dist directory...');
  rmSync('dist', { recursive: true, force: true });
}

// Generate skill docs from .tmpl templates (if bun is available and skills/ exists)
if (existsSync('skills')) {
  try {
    console.log('Generating skill docs from templates...');
    execFileSync('bun', ['run', 'scripts/gen-skill-docs.ts'], { stdio: 'inherit' });
  } catch {
    console.log('⚠️  Skipping skill doc generation (bun not available or gen-skill-docs failed)');
  }
}

// Run TypeScript compiler (use local version explicitly)
console.log('Compiling TypeScript...');
try {
  runTsc(['--version']);
  runTsc();
  console.log('\n✅ Build completed successfully!');
} catch (error) {
  console.error('\n❌ Build failed!');
  process.exit(1);
}
