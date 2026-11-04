#!/usr/bin/env node

import { execFileSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const runTsc = (args = []) => {
  const tscPath = require.resolve('typescript/bin/tsc');
  execFileSync(process.execPath, [tscPath, ...args], { stdio: 'inherit' });
};

console.log('🔨 Building Rasen...\n');

// Clean dist directory
if (existsSync('dist')) {
  console.log('Cleaning dist directory...');
  rmSync('dist', { recursive: true, force: true });
}

// Run TypeScript compiler (use local version explicitly)
console.log('Compiling TypeScript...');
try {
  runTsc(['--version']);
  runTsc();
  console.log('Building source-owned ProcessCapsule helper...');
  execFileSync(process.execPath, ['scripts/build-process-capsule.mjs'], {
    stdio: 'inherit',
  });
  if (process.platform === 'linux') {
    console.log('Building source-owned Linux process-authority helper...');
    execFileSync(process.execPath, ['scripts/build-linux-process-authority.mjs'], {
      stdio: 'inherit',
    });
  }
  console.log('\n✅ Build completed successfully!');
} catch (error) {
  console.error('\n❌ Build failed!');
  process.exit(1);
}
