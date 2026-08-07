/*
 * Windows provider mutation matrix — the instrument that produced the 20 REDs
 * recorded in lead2-apply-wave-accounting.md.
 *
 * READ THIS BEFORE TRUSTING ANY OUTPUT.
 *
 * This harness is evidence, not tooling. Check it before you draw a conclusion
 * from it. During the apply wave it produced a FALSE RED: it reported
 * `spawnSync npx.cmd EINVAL` — a spawn failure, the child never ran — as a
 * failing test. Every mutation would have "gone RED" without a single
 * assertion executing, and seventeen fabricated receipts would have been
 * banked had the captured output not been printed and read. A false RED is
 * worse than a false GREEN: it manufactures confidence in the very check used
 * to detect manufactured confidence.
 *
 * That failure is now encoded rather than only described. A run is classified
 * RED only when the child exited non-zero AND its output contains an
 * assertion-shaped line. A spawn failure reports HARNESS-ERROR; a non-zero
 * exit with no assertion in the output reports INCONCLUSIVE. Neither is RED.
 * If you modify this file, preserve that distinction or the instrument stops
 * measuring what it claims to.
 *
 * Shape: every mutation is { file, exact anchor string, replacement, suites }.
 * The anchor must match the current product byte-for-byte; a stale anchor
 * exits 3 rather than silently mutating nothing and reporting GREEN. The
 * product file is restored in a `finally`, and the restore is verified by
 * re-reading and comparing, so a crashing run cannot leave a mutated product
 * behind.
 *
 * PROVENANCE: author == verifier. All 20 REDs were produced by the author of
 * the product and tests under mutation. A non-author reproduction is owed and
 * has not happened. Re-running these as they stand touches no test file; a
 * reviewer who instead authors new mutations is producing genuinely new
 * evidence, which is fine but is a different claim.
 *
 * Usage:
 *   node <this file> --list
 *   node <this file> --all
 *   node <this file> M5-skip-post-open-reread
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..', '..');
const vitest = path.join(repo, 'node_modules', 'vitest', 'vitest.mjs');

const CONTRACT = 'test/core/session-host/windows-process-authority-contract.test.ts';
const REFERENCE = 'test/core/session-host/windows-process-authority-reference.test.ts';
const RECOVERY = 'test/core/session-host/windows-process-authority-recovery.test.ts';
const PROVIDER = 'test/core/session-host/windows-process-authority-provider.test.ts';
const LEDGER = 'test/core/session-host/windows-process-authority-publication-ledger.test.ts';
const CONFORMANCE = 'test/core/session-host/windows-process-authority-conformance.test.ts';
const RESOLVER = 'test/core/session-host/windows-process-authority-artifact-resolver.test.ts';
const PACKAGE_CI = 'test/core/session-host/windows-process-authority-package-ci.test.ts';

const OUTCOMES = 'src/core/session-host/process-authority/windows/outcomes.ts';
const PRIVATE_REFERENCE = 'src/core/session-host/process-authority/windows/private-reference.ts';
const RECOVERY_SRC = 'src/core/session-host/process-authority/windows/recovery.ts';
const PROVIDER_SRC = 'src/core/session-host/process-authority/windows/provider.ts';
const LEDGER_SRC = 'src/core/session-host/process-authority/windows/publication-ledger.ts';
const RESOLVER_SRC = 'src/core/session-host/process-authority/windows/artifact-resolver.ts';
const BUILD_SCRIPT = 'scripts/build-windows-process-authority.mjs';
const WORKFLOW = '.github/workflows/windows-process-authority.yml';

const MUTATIONS = {
  'M1-sign-extended-status': {
    file: OUTCOMES,
    from: `  if (
    typeof code !== 'number' ||
    !Number.isSafeInteger(code) ||
    code < 0 ||
    code > WINDOWS_MAX_EXIT_STATUS
  ) {
    return malformed(phase);
  }
  return Object.freeze({ state: 'root-exited', code, signal: null });`,
    to: `  if (typeof code !== 'number' || !Number.isSafeInteger(code)) {
    return malformed(phase);
  }
  return Object.freeze({ state: 'root-exited', code: code >>> 0, signal: null });`,
    suites: [CONTRACT],
  },
  'M2-synthesized-signal': {
    file: OUTCOMES,
    from: `  if (signal !== null) return malformed(phase);`,
    to: `  if (typeof signal === 'string' && signal.length > 0) {
    return Object.freeze({ state: 'root-exited', code: null, signal });
  }`,
    suites: [CONTRACT],
  },
  'M3-breakaway-mask-accepted': {
    file: PRIVATE_REFERENCE,
    from: `    value.jobLimitMask === WINDOWS_EXPECTED_JOB_LIMIT_MASK &&`,
    to: `    Number.isSafeInteger(value.jobLimitMask) &&`,
    suites: [REFERENCE],
  },
  'M4-late-port-association-accepted': {
    file: PRIVATE_REFERENCE,
    from: `    value.activeProcessCountAtPortAssociation === 0 &&`,
    to: `    Number.isSafeInteger(value.activeProcessCountAtPortAssociation) &&`,
    suites: [REFERENCE],
  },
  'M5-skip-post-open-reread': {
    file: RECOVERY_SRC,
    from: `  const postOpen = parseWindowsAuthorityIdentityProbe(postOpenValue);
  if (!postOpen) return malformedProbe();
  if (postOpen.state !== 'authority-present') {
    return retained('identity-drift', 'post-open-identity-changed');
  }
  const postFailure = classifyPresent(reference, postOpen);
  if (postFailure) return postFailure;
  if (!presentTupleUnchanged(preOpen, postOpen)) {
    return retained('identity-drift', 'post-open-identity-changed');
  }
  return Object.freeze({ disposition: 'proceed' });`,
    to: `  return Object.freeze({ disposition: 'proceed' });`,
    suites: [RECOVERY, PROVIDER],
  },
  'M6-no-boot-identity-check': {
    file: RECOVERY_SRC,
    from: `  if (preOpen.bootIdentity !== reference.bootIdentity) {
    return retained('identity-drift', 'identity-drift');
  }`,
    to: ``,
    suites: [RECOVERY],
  },
  'M7-last-handle-without-attestation': {
    file: RECOVERY_SRC,
    from: `    if (preOpen.soleHandleAttestation === reference.soleHandleAttestation) {
      return Object.freeze({ disposition: 'exact-scope-empty', basis: 'last-handle-rule' });
    }
    return retained('authority-uncertain', 'guardian-absent-without-record');`,
    to: `    return Object.freeze({ disposition: 'exact-scope-empty', basis: 'last-handle-rule' });`,
    suites: [RECOVERY],
  },
  'M8-graceful-closes-authority': {
    file: PROVIDER_SRC,
    from: `      if (intent.graceMs > 0) {
        // Deliberately discarded. A graceful step observing quiet is not an
        // empty event, so force is issued unconditionally and the receipt can
        // only ever come from the authority's own convergence.
        await transport.attemptGraceful(decoded, intent, context);
      }`,
    to: `      if (intent.graceMs > 0) {
        const graceful = await transport.attemptGraceful(decoded, intent, context) as
          { state?: unknown };
        if (graceful?.state === 'empty-observed') {
          return Object.freeze({ state: 'exact-scope-empty' });
        }
      }`,
    suites: [PROVIDER],
  },
  'M9-terminate-skips-revalidation': {
    file: PROVIDER_SRC,
    from: `      if (!decoded) return retainedObservation('authority-unavailable', 'reference-invalid');
      const classification = await reopen(decoded, context);
      if (classification.disposition === 'retained') {
        return classificationOutcome(classification, context.phase);
      }
      if (classification.disposition === 'exact-scope-empty') {
        return Object.freeze({ state: 'exact-scope-empty' });
      }
      if (intent.graceMs > 0) {`,
    to: `      if (!decoded) return retainedObservation('authority-unavailable', 'reference-invalid');
      if (intent.graceMs > 0) {`,
    suites: [PROVIDER, CONFORMANCE],
  },
  'M10-activate-skips-ledger': {
    file: PROVIDER_SRC,
    from: `      const publication = publicationAccess.requirePublished(descriptor, reference);
      if (publication.state !== 'published-inert') return ledgerOutcome(publication);`,
    to: ``,
    suites: [PROVIDER, CONFORMANCE],
  },
  'M11-resurrect-second-reterminate-loop': {
    file: PROVIDER_SRC,
    from: `    const raw = await transport.terminate(decoded, intent, context);
    if (isReterminateSignal(raw)) {
      return retainedPhaseOutcome('control-loss', context.phase, 'native-transport-lost');
    }`,
    to: `    let raw = await transport.terminate(decoded, intent, context);
    while (isReterminateSignal(raw)) {
      raw = await transport.terminate(decoded, intent, context);
    }`,
    suites: [PROVIDER],
  },
  'M12-acknowledge-before-commit': {
    file: LEDGER_SRC,
    from: `  return async (binding, context) => {
    Reflect.apply(WindowsAuthorityPublicationLedger.prototype.commit, ledger, [binding, context]);
    return createProcessAuthorityPublicationAcknowledgement(binding);
  };`,
    to: `  return async (binding, context) => {
    const acknowledgement = createProcessAuthorityPublicationAcknowledgement(binding);
    try {
      Reflect.apply(WindowsAuthorityPublicationLedger.prototype.commit, ledger, [binding, context]);
    } catch {
      // Optimistically acknowledge anyway.
    }
    return acknowledgement;
  };`,
    suites: [LEDGER],
  },
  'M13-forbidden-mechanism-guard': {
    file: OUTCOMES,
    from: `export type WindowsAuthorityDiagnosticCode = string;`,
    to: `export type WindowsAuthorityDiagnosticCode = string;
export const FALLBACK_SWEEP = 'taskkill /T /F';`,
    suites: [CONTRACT],
  },
  'M14-open-gate-reported-as-pass': {
    file: WORKFLOW,
    from: `          "Runner policy denied the kernel oracle. This check fails closed and is not a passing runtime receipt." >> $env:GITHUB_STEP_SUMMARY
          exit 1`,
    to: `          "Runner policy denied the kernel oracle." >> $env:GITHUB_STEP_SUMMARY`,
    suites: [PACKAGE_CI],
  },
  'M15-drop-reproducibility-flag': {
    file: BUILD_SCRIPT,
    from: `    'rustflags = ["-Clink-arg=/Brepro"]',`,
    to: `    'rustflags = []',`,
    suites: [PACKAGE_CI],
  },
  'M16-promote-artifact-off-windows': {
    file: RESOLVER_SRC,
    from: `  if (process.platform !== 'win32') {
    fail('cannot become authority outside an actual Windows runtime.');
  }`,
    to: ``,
    suites: [RESOLVER],
  },
  'M17-accept-unsupported-runtime-arch': {
    file: RESOLVER_SRC,
    from: `  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    fail('runtime architecture is unsupported.');
  }`,
    to: ``,
    suites: [RESOLVER],
  },
  'M18-readmit-namespace-as-boot-source': {
    file: PRIVATE_REFERENCE,
    from: `  'nt-system-boot-environment-information',
  'nt-system-time-of-day-boot-time',
] as const);`,
    to: `  'nt-system-boot-environment-information',
  'nt-system-time-of-day-boot-time',
  'boot-scoped-object-namespace',
] as const);`,
    suites: [REFERENCE],
  },
  'M19-rename-packaged-guardian': {
    file: BUILD_SCRIPT,
    from: `const guardianName = 'rasen-windows-process-authority-guardian.exe';`,
    to: `const guardianName = 'rasen-wpa-guardian.exe';`,
    suites: [PACKAGE_CI],
  },
  'M20-provider-reaches-a-mutation-switch': {
    file: PROVIDER_SRC,
    from: `const WINDOWS_RETERMINATE_SIGNAL = 'reterminate-required';`,
    to: `const WINDOWS_RETERMINATE_SIGNAL = 'reterminate-required';
const WINDOWS_DIAGNOSTIC_MUTATION = '--mutate duplicate-job-into-root';`,
    suites: [PACKAGE_CI],
  },
};

const ASSERTION_SHAPED = /(^|\s)FAIL\s|AssertionError|Tests\s+\d|Test Files\s+\d/u;

function significantLines(output) {
  return output
    .replace(/\[[0-9;]*m/gu, '')
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function runMutation(name) {
  const mutation = MUTATIONS[name];
  const target = path.join(repo, mutation.file);
  const original = fs.readFileSync(target, 'utf8');
  if (!original.includes(mutation.from)) {
    console.error(`### ${name}: ANCHOR NOT FOUND in ${mutation.file}`);
    console.error('The product moved under this mutation. Re-derive the anchor;');
    console.error('do not relax it, or the mutation silently changes nothing.');
    return 'ANCHOR-NOT-FOUND';
  }

  let verdict = 'UNKNOWN';
  try {
    fs.writeFileSync(target, original.replace(mutation.from, mutation.to));
    let output = '';
    let exited;
    try {
      output = execFileSync(process.execPath, [vitest, 'run', ...mutation.suites], {
        cwd: repo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 600_000,
      });
      exited = 0;
    } catch (error) {
      output = `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.message ?? ''}`;
      exited = typeof error.status === 'number' ? error.status : undefined;
    }

    const lines = significantLines(output);
    const asserted = lines.some((line) => ASSERTION_SHAPED.test(line));

    if (exited === undefined) {
      verdict = 'HARNESS-ERROR';
      console.log(`### ${name}: HARNESS-ERROR (the child never ran; this is NOT a RED)`);
    } else if (exited === 0) {
      verdict = 'GREEN';
      console.log(`### ${name}: GREEN (NON-DISCRIMINATING)`);
    } else if (!asserted) {
      verdict = 'INCONCLUSIVE';
      console.log(`### ${name}: INCONCLUSIVE (non-zero exit, no assertion in output)`);
    } else {
      verdict = 'RED';
      console.log(`### ${name}: RED`);
    }
    console.log(lines.filter((line) => ASSERTION_SHAPED.test(line)).join('\n') ||
      lines.slice(-15).join('\n'));
  } finally {
    fs.writeFileSync(target, original);
    const restored = fs.readFileSync(target, 'utf8') === original;
    console.log(`restored=${restored}`);
    if (!restored) {
      console.error(`FATAL: ${mutation.file} was not restored. Fix before continuing.`);
      process.exitCode = 5;
    }
  }
  return verdict;
}

const argument = process.argv[2];

if (argument === '--list') {
  for (const name of Object.keys(MUTATIONS)) console.log(name);
} else if (argument === '--all') {
  const results = [];
  for (const name of Object.keys(MUTATIONS)) results.push([name, runMutation(name)]);
  console.log('\n=== summary ===');
  for (const [name, verdict] of results) console.log(`${verdict.padEnd(16)} ${name}`);
  const red = results.filter(([, verdict]) => verdict === 'RED').length;
  console.log(`RED ${red} of ${results.length}`);
  if (red !== results.length) process.exitCode = 1;
} else if (argument && MUTATIONS[argument]) {
  if (runMutation(argument) !== 'RED') process.exitCode = 1;
} else {
  console.error(`unknown mutation: ${argument}`);
  console.error(`use --list, --all, or one of:\n${Object.keys(MUTATIONS).join('\n')}`);
  process.exitCode = 2;
}
