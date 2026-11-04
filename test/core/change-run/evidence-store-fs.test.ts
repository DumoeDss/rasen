import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  linkSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildEvidenceRef,
  EvidenceError,
} from '../../../src/core/change-run/internal/evidence.js';
import { createFilesystemEvidenceStore } from '../../../src/core/change-run/internal/evidence-store-fs.js';
import type {
  ActionId,
  ChangeInstanceId,
  Digest,
  PlanningSpaceId,
  RunId,
} from '../../../src/core/change-run/contracts.js';

const branded = <T>(value: string): T => value as T;
const RUN_ID = branded<RunId>(`run:${'a'.repeat(64)}`);
const ACTION_ID = branded<ActionId>(`action:${'b'.repeat(64)}`);

function refFor(content: Uint8Array) {
  return buildEvidenceRef({
    content,
    mediaType: 'application/json',
    observationKind: 'effect-observation',
    producer: {
      id: 'trusted-producer',
      version: '1',
      identityDigest: branded<Digest>(`sha256:${'c'.repeat(64)}`),
    },
    binding: {
      planningSpaceId: branded<PlanningSpaceId>(`planning-space:${'d'.repeat(64)}`),
      changeInstanceId: branded<ChangeInstanceId>(`change-instance:${'e'.repeat(64)}`),
      projectId: 'project-fixture',
      changeId: 'fixture-change',
      runId: RUN_ID,
      actionId: ACTION_ID,
      schema: 'trusted-evidence/1',
    },
  });
}

function objectPath(root: string, evidenceDigest: string): string {
  return path.join(
    root,
    RUN_ID.replace(/[^a-z0-9]/gi, '_'),
    'evidence',
    'objects',
    `${evidenceDigest.slice('sha256:'.length)}.json`
  );
}

function runPath(root: string): string {
  return path.join(root, RUN_ID.replace(/[^a-z0-9]/gi, '_'));
}

function expectPathUnsafe(operation: () => unknown): void {
  try {
    operation();
    throw new Error('Expected EvidenceStore path validation to reject the operation.');
  } catch (error) {
    expect(error).toBeInstanceOf(EvidenceError);
    expect((error as EvidenceError).code).toBe('evidence_path_unsafe');
  }
}

function readEvidenceInFreshProcess(file: string, expectedContentDigest: string): Buffer {
  const script = `
    import { createHash } from 'node:crypto';
    import { readFileSync } from 'node:fs';
    const envelope = JSON.parse(readFileSync(process.env.RASEN_TEST_EVIDENCE_OBJECT, 'utf8'));
    const content = Buffer.from(envelope.contentBase64, 'base64');
    if (content.toString('base64') !== envelope.contentBase64) throw new Error('non-canonical base64');
    const digest = 'sha256:' + createHash('sha256').update(content).digest('hex');
    if (digest !== process.env.RASEN_TEST_EVIDENCE_DIGEST) throw new Error('content digest mismatch');
    process.stdout.write(content.toString('base64'));
  `;
  const encoded = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      RASEN_TEST_EVIDENCE_OBJECT: file,
      RASEN_TEST_EVIDENCE_DIGEST: expectedContentDigest,
    },
  });
  return Buffer.from(encoded, 'base64');
}

function crashPublicationInFreshProcess(
  root: string,
  ref: ReturnType<typeof refFor>,
  content: Uint8Array
): void {
  const moduleUrl = pathToFileURL(
    path.resolve('src/core/change-run/internal/evidence-store-fs.ts')
  ).href;
  const loader = pathToFileURL(
    path.resolve('test/fixtures/typescript-source-loader.mjs')
  ).href;
  const script = `
    const { createFilesystemEvidenceStore } = await import(process.env.RASEN_TEST_STORE_MODULE);
    const ref = JSON.parse(process.env.RASEN_TEST_EVIDENCE_REF);
    const content = Buffer.from(process.env.RASEN_TEST_EVIDENCE_CONTENT, 'base64');
    const store = createFilesystemEvidenceStore(
      process.env.RASEN_TEST_STORE_ROOT,
      process.env.RASEN_TEST_RUN_ID,
      { maxRunBytes: 4096, maxEntries: 8 },
      (point) => {
        if (point === 'stage.after-link-directory-fsync.before-staging-unlink') {
          throw new Error('fresh-process-after-link-crash');
        }
      }
    );
    try {
      store.stageClaimed(ref, content);
      process.exitCode = 90;
    } catch (error) {
      if (!String(error).includes('fresh-process-after-link-crash')) throw error;
    }
  `;
  execFileSync(
    process.execPath,
    ['--experimental-loader', loader, '--input-type=module', '--eval', script],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        RASEN_TEST_STORE_MODULE: moduleUrl,
        RASEN_TEST_STORE_ROOT: root,
        RASEN_TEST_RUN_ID: RUN_ID,
        RASEN_TEST_EVIDENCE_REF: JSON.stringify(ref),
        RASEN_TEST_EVIDENCE_CONTENT: Buffer.from(content).toString('base64'),
      },
    }
  );
}

describe('filesystem EvidenceStore', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'rasen-evidence-store-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('atomically publishes an immutable envelope readable by a fresh store', () => {
    const content = new TextEncoder().encode('{"effect":"applied"}');
    const ref = refFor(content);
    const options = { maxRunBytes: 1024, maxEntries: 8 };

    createFilesystemEvidenceStore(root, RUN_ID, options).stageClaimed(ref, content);
    const fresh = createFilesystemEvidenceStore(root, RUN_ID, options);

    expect(Buffer.from(fresh.read(ref))).toEqual(Buffer.from(content));
    expect(fresh.usage()).toEqual({ bytes: content.byteLength, entries: 1 });
    expect(() => fresh.stageClaimed(ref, content)).not.toThrow();
  });

  it('retains verifiable bytes across an OS process boundary and rejects later tampering', () => {
    const content = new TextEncoder().encode('{"effect":"cross-process"}');
    const ref = refFor(content);
    const options = { maxRunBytes: 1024, maxEntries: 8 };
    const target = objectPath(root, ref.evidenceDigest);

    createFilesystemEvidenceStore(root, RUN_ID, options).stageClaimed(ref, content);
    expect(readEvidenceInFreshProcess(target, ref.contentDigest)).toEqual(Buffer.from(content));

    const envelope = JSON.parse(readFileSync(target, 'utf8')) as { contentBase64: string };
    envelope.contentBase64 = Buffer.from('{"effect":"tampered"}').toString('base64');
    writeFileSync(target, JSON.stringify(envelope));
    expect(() => readEvidenceInFreshProcess(target, ref.contentDigest)).toThrow();
    expect(() => createFilesystemEvidenceStore(root, RUN_ID, options).read(ref)).toThrow();
  });

  it('rejects a semantically equivalent but non-canonical stored envelope', () => {
    const content = new TextEncoder().encode('{"effect":"non-canonical-envelope"}');
    const ref = refFor(content);
    const options = { maxRunBytes: 1024, maxEntries: 8 };
    const target = objectPath(root, ref.evidenceDigest);
    const store = createFilesystemEvidenceStore(root, RUN_ID, options);
    store.stageClaimed(ref, content);

    const envelope = JSON.parse(readFileSync(target, 'utf8'));
    writeFileSync(target, JSON.stringify(envelope, null, 2));

    expect(() => store.read(ref)).toThrow(/exact canonical JSON/);
    expect(() => store.usage()).toThrow(/exact canonical JSON/);
  });

  it('fails closed for missing, tampered, linked, and oversized evidence objects', () => {
    const content = new TextEncoder().encode('{"effect":"applied"}');
    const ref = refFor(content);
    const options = { maxRunBytes: 64, maxEntries: 8 };
    const store = createFilesystemEvidenceStore(root, RUN_ID, options);

    expect(() => store.read(ref)).toThrow(/No persistent evidence object/);

    store.stageClaimed(ref, content);
    const target = objectPath(root, ref.evidenceDigest);
    writeFileSync(target, '{"format":"change-run-evidence-object/1","ref":{},"contentBase64":""}');
    expect(() => store.read(ref)).toThrow();

    rmSync(target, { force: true });
    const outside = path.join(root, 'outside.json');
    writeFileSync(outside, Buffer.alloc(8, 1));
    symlinkSync(outside, target, 'file');
    expect(() => store.read(ref)).toThrow(/physical regular file|unsafe/i);

    rmSync(target, { force: true });
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, Buffer.alloc(128 * 1024, 1));
    expect(() => store.read(ref)).toThrow(/bounded physical regular file|budget/i);
  });

  it('rejects a canonical evidence object with a second hard link', () => {
    const content = new TextEncoder().encode('{"effect":"hard-linked"}');
    const ref = refFor(content);
    const store = createFilesystemEvidenceStore(root, RUN_ID, {
      maxRunBytes: 1024,
      maxEntries: 8,
    });
    store.stageClaimed(ref, content);
    const target = objectPath(root, ref.evidenceDigest);
    const secondName = path.join(root, 'second-hard-link.json');
    linkSync(target, secondName);

    expectPathUnsafe(() => store.read(ref));
    expect(readFileSync(secondName)).toEqual(readFileSync(target));
  });

  it('recovers only the exact strict post-link publication companion after a crash', () => {
    const content = new TextEncoder().encode('{"effect":"post-link-crash"}');
    const ref = refFor(content);
    const options = { maxRunBytes: 1024, maxEntries: 8 };
    const crashed = createFilesystemEvidenceStore(
      root,
      RUN_ID,
      options,
      (point) => {
        if (point === 'stage.after-link-directory-fsync.before-staging-unlink') {
          throw new Error('simulated abrupt process stop');
        }
      }
    );

    expect(() => crashed.stageClaimed(ref, content)).toThrow(
      /simulated abrupt process stop/
    );
    const target = objectPath(root, ref.evidenceDigest);
    const objectsDir = path.dirname(target);
    const digestHex = ref.evidenceDigest.slice('sha256:'.length);
    const entries = readdirSync(objectsDir).sort();
    const companions = entries.filter((name) =>
      new RegExp(`^\\.${digestHex}\\.evidence-publish-v1\\.[0-9a-f]{64}\\.staging$`).test(name)
    );
    expect(entries).toEqual([`${digestHex}.json`, companions[0]!].sort());
    expect(companions).toHaveLength(1);
    const companion = path.join(objectsDir, companions[0]!);
    const finalStat = statSync(target);
    const companionStat = statSync(companion);
    expect(finalStat.ino).toBe(companionStat.ino);
    expect(finalStat.dev).toBe(companionStat.dev);
    expect(finalStat.nlink).toBe(2);
    expect(companionStat.nlink).toBe(2);
    expect(readFileSync(target)).toEqual(readFileSync(companion));

    expect(() =>
      createFilesystemEvidenceStore(root, RUN_ID, options).stageClaimed(ref, content)
    ).not.toThrow();
    expect(readdirSync(objectsDir)).toEqual([`${digestHex}.json`]);
    expect(statSync(target).nlink).toBe(1);
    expect(
      Buffer.from(createFilesystemEvidenceStore(root, RUN_ID, options).read(ref))
    ).toEqual(Buffer.from(content));
  });

  it('recovers an after-link crash in the same store instance with a one-shot fault', () => {
    const content = new TextEncoder().encode('{"effect":"same-store-retry"}');
    const ref = refFor(content);
    const options = { maxRunBytes: 4096, maxEntries: 8 };
    let faulted = false;
    const store = createFilesystemEvidenceStore(root, RUN_ID, options, (point) => {
      if (
        point === 'stage.after-link-directory-fsync.before-staging-unlink' &&
        !faulted
      ) {
        faulted = true;
        throw new Error('one-shot-after-link-crash');
      }
    });

    expect(() => store.stageClaimed(ref, content)).toThrow(
      /one-shot-after-link-crash/
    );
    expect(() => store.stageClaimed(ref, content)).not.toThrow();
    const target = objectPath(root, ref.evidenceDigest);
    expect(statSync(target).nlink).toBe(1);
    expect(Buffer.from(store.read(ref))).toEqual(Buffer.from(content));
  });

  it('recovers topology left by a genuinely separate crashed OS process', () => {
    const content = new TextEncoder().encode('{"effect":"fresh-process-retry"}');
    const ref = refFor(content);
    const options = { maxRunBytes: 4096, maxEntries: 8 };

    crashPublicationInFreshProcess(root, ref, content);
    const target = objectPath(root, ref.evidenceDigest);
    const objectsDir = path.dirname(target);
    expect(statSync(target).nlink).toBe(2);
    expect(readdirSync(objectsDir).filter((name) => name.endsWith('.staging'))).toHaveLength(1);

    const fresh = createFilesystemEvidenceStore(root, RUN_ID, options);
    expect(() => fresh.stageClaimed(ref, content)).not.toThrow();
    expect(statSync(target).nlink).toBe(1);
    expect(readdirSync(objectsDir).filter((name) => name.endsWith('.staging'))).toEqual([]);
    expect(Buffer.from(fresh.read(ref))).toEqual(Buffer.from(content));
  });

  it('keeps before-link orphans invisible and treats after-unlink faults as idempotent', () => {
    const beforeContent = new TextEncoder().encode('{"fault":"before-link"}');
    const beforeRef = refFor(beforeContent);
    const options = { maxRunBytes: 4096, maxEntries: 8 };
    expect(() =>
      createFilesystemEvidenceStore(root, RUN_ID, options, (point) => {
        if (point === 'stage.after-staging-file-fsync.before-link') {
          throw new Error('before-link crash');
        }
      }).stageClaimed(beforeRef, beforeContent)
    ).toThrow(/before-link crash/);
    const beforeTarget = objectPath(root, beforeRef.evidenceDigest);
    const objectsDir = path.dirname(beforeTarget);
    expect(readdirSync(objectsDir).some((name) => /^[0-9a-f]{64}\.json$/.test(name))).toBe(false);
    const orphan = readdirSync(objectsDir).find((name) => name.endsWith('.staging'))!;
    expect(statSync(path.join(objectsDir, orphan)).nlink).toBe(1);
    createFilesystemEvidenceStore(root, RUN_ID, options).stageClaimed(beforeRef, beforeContent);
    expect(statSync(beforeTarget).nlink).toBe(1);
    expect(readdirSync(objectsDir)).toContain(orphan);

    const afterContent = new TextEncoder().encode('{"fault":"after-unlink"}');
    const afterRef = refFor(afterContent);
    expect(() =>
      createFilesystemEvidenceStore(root, RUN_ID, options, (point) => {
        if (point === 'stage.after-staging-unlink-directory-fsync.before-return') {
          throw new Error('after-unlink crash');
        }
      }).stageClaimed(afterRef, afterContent)
    ).toThrow(/after-unlink crash/);
    const afterTarget = objectPath(root, afterRef.evidenceDigest);
    expect(statSync(afterTarget).nlink).toBe(1);
    expect(() =>
      createFilesystemEvidenceStore(root, RUN_ID, options).stageClaimed(afterRef, afterContent)
    ).not.toThrow();
  });

  it('resolves a real EEXIST writer interleaving to one immutable canonical object', () => {
    const content = new TextEncoder().encode('{"race":"same-ref"}');
    const ref = refFor(content);
    const options = { maxRunBytes: 4096, maxEntries: 8 };
    let competingWriterRan = false;
    const first = createFilesystemEvidenceStore(root, RUN_ID, options, (point) => {
      if (
        point === 'stage.after-staging-file-fsync.before-link' &&
        !competingWriterRan
      ) {
        competingWriterRan = true;
        createFilesystemEvidenceStore(root, RUN_ID, options).stageClaimed(ref, content);
      }
    });

    expect(() => first.stageClaimed(ref, content)).not.toThrow();
    expect(competingWriterRan).toBe(true);
    const target = objectPath(root, ref.evidenceDigest);
    expect(statSync(target).nlink).toBe(1);
    expect(Buffer.from(first.read(ref))).toEqual(Buffer.from(content));
    expect(readdirSync(path.dirname(target))).toEqual([
      `${ref.evidenceDigest.slice('sha256:'.length)}.json`,
    ]);
  });

  it('does not unlink a same-inode strict companion whose envelope is no longer valid', () => {
    const content = new TextEncoder().encode('{"crash":"wrong-envelope"}');
    const ref = refFor(content);
    const options = { maxRunBytes: 4096, maxEntries: 8 };
    expect(() =>
      createFilesystemEvidenceStore(root, RUN_ID, options, (point) => {
        if (point === 'stage.after-link-directory-fsync.before-staging-unlink') {
          throw new Error('crash with linked companion');
        }
      }).stageClaimed(ref, content)
    ).toThrow(/crash with linked companion/);
    const target = objectPath(root, ref.evidenceDigest);
    const objectsDir = path.dirname(target);
    const companion = readdirSync(objectsDir).find((name) => name.endsWith('.staging'))!;
    writeFileSync(target, '{"not":"the signed envelope"}');

    expect(() =>
      createFilesystemEvidenceStore(root, RUN_ID, options).stageClaimed(ref, content)
    ).toThrow(/envelope|malformed|corrupt/i);
    expect(readdirSync(objectsDir)).toContain(companion);
    expect(statSync(target).nlink).toBe(2);
    expect(statSync(path.join(objectsDir, companion)).nlink).toBe(2);
  });

  it('does not choose or delete among multiple strict publication candidates', () => {
    const content = new TextEncoder().encode('{"topology":"multiple-candidates"}');
    const ref = refFor(content);
    const options = { maxRunBytes: 4096, maxEntries: 8 };
    const store = createFilesystemEvidenceStore(root, RUN_ID, options);
    store.stageClaimed(ref, content);
    const target = objectPath(root, ref.evidenceDigest);
    const objectsDir = path.dirname(target);
    const digestHex = ref.evidenceDigest.slice('sha256:'.length);
    const first = path.join(
      objectsDir,
      `.${digestHex}.evidence-publish-v1.${'1'.repeat(64)}.staging`
    );
    const second = path.join(
      objectsDir,
      `.${digestHex}.evidence-publish-v1.${'2'.repeat(64)}.staging`
    );
    linkSync(target, first);
    writeFileSync(second, 'different inode');

    expectPathUnsafe(() => store.stageClaimed(ref, content));
    expect(readFileSync(first)).toEqual(readFileSync(target));
    expect(readFileSync(second, 'utf8')).toBe('different inode');
  });

  it('never deletes unprovable multiple-link or strict-name/different-inode topologies', () => {
    const content = new TextEncoder().encode('{"effect":"unprovable"}');
    const ref = refFor(content);
    const options = { maxRunBytes: 4096, maxEntries: 8 };
    const store = createFilesystemEvidenceStore(root, RUN_ID, options);
    store.stageClaimed(ref, content);
    const target = objectPath(root, ref.evidenceDigest);
    const objectsDir = path.dirname(target);
    const digestHex = ref.evidenceDigest.slice('sha256:'.length);
    const externalOne = path.join(root, 'external-one.json');
    const externalTwo = path.join(root, 'external-two.json');
    linkSync(target, externalOne);
    linkSync(target, externalTwo);
    expect(statSync(target).nlink).toBe(3);
    expectPathUnsafe(() => store.stageClaimed(ref, content));
    expect(readFileSync(externalOne)).toEqual(readFileSync(target));
    expect(readFileSync(externalTwo)).toEqual(readFileSync(target));

    rmSync(externalTwo);
    const fakeStrict = path.join(
      objectsDir,
      `.${digestHex}.evidence-publish-v1.${'f'.repeat(64)}.staging`
    );
    writeFileSync(fakeStrict, 'not the target inode');
    expect(statSync(target).nlink).toBe(2);
    expectPathUnsafe(() => store.stageClaimed(ref, content));
    expect(readFileSync(fakeStrict, 'utf8')).toBe('not the target inode');
    expect(readFileSync(externalOne)).toEqual(readFileSync(target));
  });

  it('rejects an unsafe evidence parent before read or stage creates outside objects', () => {
    const content = new TextEncoder().encode('{"effect":"parent-link"}');
    const ref = refFor(content);
    const outside = mkdtempSync(path.join(tmpdir(), 'rasen-evidence-outside-'));
    try {
      const runDir = runPath(root);
      mkdirSync(runDir, { recursive: true });
      const unsafeEvidence = path.join(runDir, 'evidence');
      symlinkSync(
        outside,
        unsafeEvidence,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      const store = createFilesystemEvidenceStore(root, RUN_ID, {
        maxRunBytes: 1024,
        maxEntries: 8,
      });

      expectPathUnsafe(() => store.read(ref));
      expect(readdirSync(outside)).toEqual([]);
      expectPathUnsafe(() => store.stageClaimed(ref, content));
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects an unsafe store anchor before read or stage creates outside paths', () => {
    const content = new TextEncoder().encode('{"effect":"anchor-link"}');
    const ref = refFor(content);
    const outside = mkdtempSync(path.join(tmpdir(), 'rasen-evidence-anchor-'));
    const linkedRoot = path.join(root, 'linked-store-root');
    try {
      symlinkSync(
        outside,
        linkedRoot,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      const store = createFilesystemEvidenceStore(linkedRoot, RUN_ID, {
        maxRunBytes: 1024,
        maxEntries: 8,
      });

      expectPathUnsafe(() => store.read(ref));
      expect(readdirSync(outside)).toEqual([]);
      expectPathUnsafe(() => store.stageClaimed(ref, content));
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
