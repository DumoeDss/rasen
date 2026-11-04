import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fsyncSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  type Dirent,
  type Stats,
} from 'node:fs';
import path from 'node:path';

import { decodeEvidenceRef, type Digest, type EvidenceRef, type RunId } from '../contracts.js';
import { canonicalJson } from './identity.js';
import {
  computeEvidenceContentDigest,
  evidenceSizeBytes,
  EvidenceError,
  verifyEvidenceContent,
  verifyEvidenceRefIdentity,
  type BoundedEvidenceOptions,
  type BoundedEvidenceStore,
} from './evidence.js';

interface StoredEvidenceEnvelope {
  readonly format:
    | 'change-run-evidence-object/1'
    | 'change-run-evidence-object/2';
  readonly ref: EvidenceRef;
  readonly contentBase64: string;
}

export type EvidencePublicationFaultPoint =
  | 'stage.after-staging-file-fsync.before-link'
  | 'stage.after-link-directory-fsync.before-staging-unlink'
  | 'stage.after-staging-unlink-directory-fsync.before-return';

export type EvidencePublicationFaultInjector = (
  point: EvidencePublicationFaultPoint
) => void;

function runDirectory(rootDir: string, runId: RunId): string {
  return path.join(rootDir, runId.replace(/[^a-z0-9]/gi, '_'));
}

function objectName(ref: EvidenceRef): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(ref.evidenceDigest)) {
    throw new EvidenceError('evidence_path_unsafe', 'Evidence digest is not a canonical safe name.');
  }
  return `${ref.evidenceDigest.slice('sha256:'.length)}.json`;
}

function pathUnsafe(message: string, cause?: unknown): EvidenceError {
  const error = new EvidenceError('evidence_path_unsafe', message);
  if (cause !== undefined) {
    Object.defineProperty(error, 'cause', { value: cause, enumerable: false });
  }
  return error;
}

function lstatOptional(candidate: string): Stats | undefined {
  try {
    return lstatSync(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw pathUnsafe('EvidenceStore path identity could not be inspected.', error);
  }
}

function assertPhysicalDirectory(dir: string, stat = lstatOptional(dir)): Stats {
  if (stat === undefined || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new EvidenceError(
      'evidence_path_unsafe',
      'EvidenceStore directory is not a physical directory.'
    );
  }
  return stat;
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    (left.ino !== 0 || left.birthtimeMs === right.birthtimeMs)
  );
}

function isContained(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function physicalPath(candidate: string): string {
  try {
    return realpathSync.native(candidate);
  } catch (error) {
    throw pathUnsafe('EvidenceStore physical path could not be resolved.', error);
  }
}

/**
 * Validate the controlled store anchor before touching descendants, then walk
 * the fixed Run/evidence/objects components one at a time. No recursive mkdir
 * is permitted: every existing component is lstat'd without following links;
 * every new component is created only beneath a revalidated physical parent
 * and is checked again immediately after creation.
 */
function ensureSafeDirectoryTree(
  rootDir: string,
  components: readonly string[]
): string {
  const anchor = path.resolve(rootDir);
  const anchorBefore = assertPhysicalDirectory(anchor);
  const physicalAnchor = physicalPath(anchor);
  const anchorAfter = assertPhysicalDirectory(anchor);
  if (!sameIdentity(anchorBefore, anchorAfter) || physicalPath(anchor) !== physicalAnchor) {
    throw pathUnsafe('EvidenceStore anchor identity is unstable.');
  }

  let parent = anchor;
  let parentIdentity = anchorBefore;
  for (const component of components) {
    if (
      component.length === 0 ||
      component === '.' ||
      component === '..' ||
      component.includes('/') ||
      component.includes('\\')
    ) {
      throw pathUnsafe('EvidenceStore component is not a safe direct name.');
    }
    const candidate = path.join(parent, component);
    const parentBefore = assertPhysicalDirectory(parent);
    if (!sameIdentity(parentIdentity, parentBefore)) {
      throw pathUnsafe('EvidenceStore parent identity changed before use.');
    }
    const parentPhysical = physicalPath(parent);
    if (!isContained(physicalAnchor, parentPhysical)) {
      throw pathUnsafe('EvidenceStore parent escaped its controlled anchor.');
    }

    let candidateStat = lstatOptional(candidate);
    if (candidateStat === undefined) {
      try {
        mkdirSync(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw pathUnsafe('EvidenceStore directory could not be created safely.', error);
        }
      }
      candidateStat = lstatOptional(candidate);
    }
    const childIdentity = assertPhysicalDirectory(candidate, candidateStat);
    const childPhysical = physicalPath(candidate);
    if (!isContained(physicalAnchor, childPhysical)) {
      throw pathUnsafe('EvidenceStore directory escaped its controlled anchor.');
    }
    const parentAfter = assertPhysicalDirectory(parent);
    if (!sameIdentity(parentBefore, parentAfter)) {
      throw pathUnsafe('EvidenceStore parent identity changed during use.');
    }
    parent = candidate;
    parentIdentity = childIdentity;
  }
  return parent;
}

function readPhysicalFile(
  file: string,
  maxBytes: number,
  expectedLinkCount = 1
): Buffer {
  const before = lstatOptional(file);
  if (before === undefined) {
    throw pathUnsafe('Evidence object disappeared before its physical identity was inspected.');
  }
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== expectedLinkCount ||
    before.size > maxBytes
  ) {
    throw new EvidenceError(
      before.size > maxBytes ? 'evidence_budget_exceeded' : 'evidence_path_unsafe',
      'Evidence object is not a bounded physical regular file.'
    );
  }
  const noFollow = 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0;
  let fd: number;
  try {
    fd = openSync(file, constants.O_RDONLY | noFollow);
  } catch (error) {
    throw pathUnsafe('Evidence object could not be opened without following links.', error);
  }
  try {
    const opened = fstatSync(fd);
    const bytes = readFileSync(fd);
    const after = lstatOptional(file);
    if (
      after === undefined ||
      bytes.byteLength > maxBytes ||
      !opened.isFile() ||
      opened.nlink !== expectedLinkCount ||
      after.nlink !== expectedLinkCount ||
      before.dev !== opened.dev ||
      before.ino !== opened.ino ||
      opened.dev !== after.dev ||
      opened.ino !== after.ino ||
      before.size !== opened.size ||
      opened.size !== after.size ||
      before.mtimeMs !== opened.mtimeMs ||
      opened.mtimeMs !== after.mtimeMs
    ) {
      throw new EvidenceError(
        'evidence_store_corrupt',
        'Evidence object changed during its bounded read.'
      );
    }
    return bytes;
  } finally {
    closeSync(fd);
  }
}

/**
 * Run-scoped persistent EvidenceStore. Objects live below the same controlled
 * Run directory as plan/Record truth and are addressed only by a validated
 * evidence digest. Publication is staging+fsync+hard-link: the final name is
 * created atomically without replacement on Windows and POSIX.
 */
export function createFilesystemEvidenceStore(
  rootDir: string,
  runId: RunId,
  options: BoundedEvidenceOptions,
  faultInjector?: EvidencePublicationFaultInjector
): BoundedEvidenceStore {
  const runName = runId.replace(/[^a-z0-9]/gi, '_');
  const maxObjectBytes = Math.max(4096, Math.ceil(options.maxRunBytes * 1.5) + 64 * 1024);

  const ensure = (): string => ensureSafeDirectoryTree(rootDir, [runName, 'evidence', 'objects']);
  const finalPath = (objectsDir: string, ref: EvidenceRef): string =>
    path.join(objectsDir, objectName(ref));

  const synchronizeDirectory = (objectsDir: string): void => {
    let fd: number | undefined;
    try {
      fd = openSync(objectsDir, constants.O_RDONLY);
      fsyncSync(fd);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Node/Windows does not guarantee that directory handles can be opened
      // and flushed. Suppress only the documented unsupported-handle family;
      // every other I/O failure remains fail-closed.
      if (
        process.platform !== 'win32' ||
        !['EACCES', 'EBADF', 'EINVAL', 'EPERM'].includes(code ?? '')
      ) {
        throw pathUnsafe('EvidenceStore directory could not be synchronized.', error);
      }
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };

  const decodeEnvelopeBytes = (
    raw: Buffer,
    ref: EvidenceRef
  ): StoredEvidenceEnvelope => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new EvidenceError(
        'evidence_store_corrupt',
        'Persistent evidence object is malformed.'
      );
    }
    const expectedFormat: StoredEvidenceEnvelope['format'] =
      ref.format === 'change-run-evidence-ref/2'
      ? 'change-run-evidence-object/2'
      : 'change-run-evidence-object/1';
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      (parsed as { format?: unknown }).format !== expectedFormat ||
      typeof (parsed as { contentBase64?: unknown }).contentBase64 !== 'string'
    ) {
      throw new EvidenceError(
        'evidence_store_corrupt',
        'Persistent evidence envelope is invalid.'
      );
    }
    const storedRef = decodeEvidenceRef((parsed as { ref?: unknown }).ref);
    if (canonicalJson(storedRef) !== canonicalJson(ref)) {
      throw new EvidenceError(
        'evidence_identity_mismatch',
        'Persistent evidence envelope does not match the requested EvidenceRef.'
      );
    }
    const contentBase64 = (parsed as { contentBase64: string }).contentBase64;
    const content = Buffer.from(contentBase64, 'base64');
    if (content.toString('base64') !== contentBase64) {
      throw new EvidenceError(
        'evidence_store_corrupt',
        'Persistent evidence bytes are not canonical base64.'
      );
    }
    verifyEvidenceContent(ref, content);
    const envelope = { format: expectedFormat, ref: storedRef, contentBase64 };
    if (!raw.equals(Buffer.from(canonicalJson(envelope), 'utf8'))) {
      throw new EvidenceError(
        'evidence_store_corrupt',
        'Persistent evidence envelope is not exact canonical JSON.'
      );
    }
    return envelope;
  };

  /** Recover only the store-owned, exhaustively proven two-link topology. */
  const recoverPublishedCompanion = (
    objectsDir: string,
    ref: EvidenceRef
  ): void => {
    const target = finalPath(objectsDir, ref);
    const finalBefore = lstatOptional(target);
    if (finalBefore === undefined || finalBefore.nlink === 1) return;
    if (
      !finalBefore.isFile() ||
      finalBefore.isSymbolicLink() ||
      finalBefore.nlink !== 2
    ) {
      throw pathUnsafe('Evidence object has an unprovable physical link topology.');
    }
    const digestHex = ref.evidenceDigest.slice('sha256:'.length);
    const grammar = new RegExp(
      `^\\.${digestHex}\\.evidence-publish-v1\\.[0-9a-f]{64}\\.staging$`
    );
    const candidates = readdirSync(objectsDir, { withFileTypes: true })
      .filter((entry) => grammar.test(entry.name))
      .map((entry) => path.join(objectsDir, entry.name));
    if (candidates.length !== 1) {
      throw pathUnsafe('Evidence object has no unique strict publication companion.');
    }
    const companion = candidates[0]!;
    const companionBefore = lstatOptional(companion);
    if (
      companionBefore === undefined ||
      !companionBefore.isFile() ||
      companionBefore.isSymbolicLink() ||
      companionBefore.nlink !== 2 ||
      !sameIdentity(finalBefore, companionBefore)
    ) {
      throw pathUnsafe('Evidence publication companion identity is not provable.');
    }
    const finalBytes = readPhysicalFile(target, maxObjectBytes, 2);
    const companionBytes = readPhysicalFile(companion, maxObjectBytes, 2);
    const finalAfterRead = lstatOptional(target);
    const companionAfterRead = lstatOptional(companion);
    if (
      finalAfterRead === undefined ||
      companionAfterRead === undefined ||
      !sameIdentity(finalBefore, finalAfterRead) ||
      !sameIdentity(companionBefore, companionAfterRead) ||
      !sameIdentity(finalAfterRead, companionAfterRead) ||
      finalAfterRead.nlink !== 2 ||
      companionAfterRead.nlink !== 2 ||
      !finalBytes.equals(companionBytes)
    ) {
      throw pathUnsafe('Evidence publication companion changed during proof.');
    }
    decodeEnvelopeBytes(finalBytes, ref);
    const objectsBefore = assertPhysicalDirectory(objectsDir);
    unlinkSync(companion);
    synchronizeDirectory(objectsDir);
    const objectsAfter = assertPhysicalDirectory(objectsDir);
    const finalAfter = lstatOptional(target);
    if (
      !sameIdentity(objectsBefore, objectsAfter) ||
      finalAfter === undefined ||
      !sameIdentity(finalBefore, finalAfter) ||
      finalAfter.nlink !== 1 ||
      !readPhysicalFile(target, maxObjectBytes).equals(finalBytes)
    ) {
      throw pathUnsafe('Recovered Evidence object did not stabilize at one link.');
    }
  };

  const readEnvelope = (ref: EvidenceRef): StoredEvidenceEnvelope => {
    const objectsDir = ensure();
    const file = finalPath(objectsDir, ref);
    if (lstatOptional(file) === undefined) {
      throw new EvidenceError(
        'evidence_content_mismatch',
        'No persistent evidence object matches this EvidenceRef.'
      );
    }
    recoverPublishedCompanion(objectsDir, ref);
    return decodeEnvelopeBytes(readPhysicalFile(file, maxObjectBytes), ref);
  };

  const read = (ref: EvidenceRef): Uint8Array => {
    verifyEvidenceRefIdentity(ref);
    const envelope = readEnvelope(ref);
    const content = Buffer.from(envelope.contentBase64, 'base64');
    if (content.toString('base64') !== envelope.contentBase64) {
      throw new EvidenceError('evidence_store_corrupt', 'Persistent evidence bytes are not canonical base64.');
    }
    verifyEvidenceContent(ref, content);
    return new Uint8Array(content);
  };

  const usage = (): Readonly<{ bytes: number; entries: number }> => {
    const objectsDir = ensure();
    const objectsBefore = assertPhysicalDirectory(objectsDir);
    let bytes = 0;
    let entries = 0;
    let directoryEntries: Dirent[];
    try {
      directoryEntries = readdirSync(objectsDir, { withFileTypes: true });
    } catch (error) {
      throw pathUnsafe('EvidenceStore directory could not be enumerated safely.', error);
    }
    for (const entry of directoryEntries) {
      if (!/^[0-9a-f]{64}\.json$/.test(entry.name) || !entry.isFile()) continue;
      entries += 1;
      if (entries > options.maxEntries) {
        throw new EvidenceError('evidence_store_corrupt', 'EvidenceStore entry bound is exceeded.');
      }
      const raw = readPhysicalFile(path.join(objectsDir, entry.name), maxObjectBytes);
      let parsed: unknown;
      try { parsed = JSON.parse(raw.toString('utf8')); } catch {
        throw new EvidenceError('evidence_store_corrupt', 'Persistent evidence object is malformed.');
      }
      const ref = decodeEvidenceRef((parsed as { ref?: unknown }).ref);
      decodeEnvelopeBytes(raw, ref);
      bytes += evidenceSizeBytes(ref);
      if (bytes > options.maxRunBytes) {
        throw new EvidenceError('evidence_store_corrupt', 'EvidenceStore byte bound is exceeded.');
      }
    }
    const objectsAfter = assertPhysicalDirectory(objectsDir);
    if (!sameIdentity(objectsBefore, objectsAfter)) {
      throw pathUnsafe('EvidenceStore directory identity changed during enumeration.');
    }
    return Object.freeze({ bytes, entries });
  };

  return Object.freeze({
    stage(content: Uint8Array): Digest {
      return computeEvidenceContentDigest(content);
    },
    stageClaimed(ref: EvidenceRef, content: Uint8Array): void {
      verifyEvidenceRefIdentity(ref);
      verifyEvidenceContent(ref, content);
      const objectsDir = ensure();
      const target = finalPath(objectsDir, ref);
      if (lstatOptional(target) !== undefined) {
        recoverPublishedCompanion(objectsDir, ref);
        read(ref);
        return;
      }
      const current = usage();
      if (
        current.entries + 1 > options.maxEntries ||
        current.bytes + content.byteLength > options.maxRunBytes
      ) {
        throw new EvidenceError('evidence_budget_exceeded', 'EvidenceStore Run budget is exceeded.');
      }
      const envelope: StoredEvidenceEnvelope = {
        format: ref.format === 'change-run-evidence-ref/2'
          ? 'change-run-evidence-object/2'
          : 'change-run-evidence-object/1',
        ref,
        contentBase64: Buffer.from(content).toString('base64'),
      };
      const digestHex = ref.evidenceDigest.slice('sha256:'.length);
      const staging = path.join(
        objectsDir,
        `.${digestHex}.evidence-publish-v1.${randomBytes(32).toString('hex')}.staging`
      );
      const bytes = Buffer.from(canonicalJson(envelope), 'utf8');
      let linked = false;
      let linkCreated = false;
      let abruptFault = false;
      let publishedIdentity: Stats | undefined;
      let stagedWrittenIdentity: Stats | undefined;
      const inject = (point: EvidencePublicationFaultPoint): void => {
        if (faultInjector === undefined) return;
        abruptFault = true;
        faultInjector(point);
        abruptFault = false;
      };
      try {
        const noFollow = 'O_NOFOLLOW' in constants ? constants.O_NOFOLLOW : 0;
        const fd = openSync(
          staging,
          constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow,
          0o600
        );
        try {
          writeFileSync(fd, bytes);
          fsyncSync(fd);
          const staged = fstatSync(fd);
          if (!staged.isFile() || staged.nlink !== 1 || staged.size !== bytes.byteLength) {
            throw pathUnsafe('Evidence staging object has an unsafe physical identity.');
          }
          stagedWrittenIdentity = staged;
        } finally {
          closeSync(fd);
        }
        inject('stage.after-staging-file-fsync.before-link');
        const stagedBeforeLink = lstatOptional(staging);
        if (
          stagedBeforeLink === undefined ||
          stagedWrittenIdentity === undefined ||
          !stagedBeforeLink.isFile() ||
          stagedBeforeLink.nlink !== 1 ||
          !sameIdentity(stagedWrittenIdentity, stagedBeforeLink) ||
          stagedWrittenIdentity.size !== stagedBeforeLink.size ||
          stagedWrittenIdentity.mtimeMs !== stagedBeforeLink.mtimeMs
        ) {
          throw pathUnsafe('Evidence staging object changed before publication.');
        }
        const revalidatedObjectsDir = ensure();
        if (revalidatedObjectsDir !== objectsDir) {
          throw pathUnsafe('EvidenceStore publication directory changed unexpectedly.');
        }
        try {
          linkSync(staging, target);
          linkCreated = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw pathUnsafe('Evidence object could not be published safely.', error);
          }
        }
        const stagedAfterLink = lstatOptional(staging);
        const targetAfterLink = lstatOptional(target);
        if (linkCreated) {
          const safePublishedTopology =
            stagedAfterLink !== undefined &&
            targetAfterLink !== undefined &&
            sameIdentity(stagedBeforeLink, stagedAfterLink) &&
            sameIdentity(stagedAfterLink, targetAfterLink) &&
            stagedAfterLink.nlink === 2 &&
            targetAfterLink.nlink === 2;
          if (!safePublishedTopology) {
            if (
              stagedAfterLink !== undefined &&
              targetAfterLink !== undefined &&
              sameIdentity(stagedAfterLink, targetAfterLink)
            ) {
              try { unlinkSync(target); } catch { /* fail closed below */ }
            }
            throw pathUnsafe('Evidence publication did not preserve the required link topology.');
          }
          linked = true;
          publishedIdentity = targetAfterLink;
          // Publish the final directory entry before exposing the post-link
          // crash point. On Windows this is the strongest supported policy.
          synchronizeDirectory(objectsDir);
          inject('stage.after-link-directory-fsync.before-staging-unlink');
        }
      } finally {
        if (!abruptFault) {
          try {
            const stagingBeforeUnlink = lstatOptional(staging);
            if (
              stagingBeforeUnlink !== undefined &&
              stagedWrittenIdentity !== undefined &&
              sameIdentity(stagingBeforeUnlink, stagedWrittenIdentity)
            ) {
              unlinkSync(staging);
              synchronizeDirectory(objectsDir);
            }
          } catch {
            /* fail closed through the topology/readback checks below */
          }
        }
      }
      if (!linked && lstatOptional(target) === undefined) {
        throw new EvidenceError('evidence_store_corrupt', 'Evidence publication did not create a final object.');
      }
      if (linked) {
        const published = lstatOptional(target);
        if (
          published === undefined ||
          publishedIdentity === undefined ||
          !sameIdentity(publishedIdentity, published) ||
          published.nlink !== 1
        ) {
          throw pathUnsafe('Evidence object has an unsafe physical identity after publication.');
        }
        inject('stage.after-staging-unlink-directory-fsync.before-return');
      }
      read(ref);
    },
    read,
    has(ref: EvidenceRef): boolean {
      try {
        read(ref);
        return true;
      } catch {
        return false;
      }
    },
    usage,
  });
}
