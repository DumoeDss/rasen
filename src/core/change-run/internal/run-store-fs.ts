import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { CanonicalRunRecord } from './record.js';
import { decodeCanonicalRunRecord, digestCanonicalRunRecord } from './record.js';
import type { RunId } from '../contracts.js';
import {
  RunStoreError,
  type RunStore,
  type RunSummary,
} from './run-store.js';

/**
 * Filesystem RunStore (task 9.2 "in registered machine-home"). Each Record
 * revision is published immutably with `wx` (O_EXCL) semantics as
 * `<root>/<runId>/record-v<version>.json`; the highest present version is the
 * head. create publishes v0; commit validates the predecessor digest and
 * publishes the next version. Reads never fall back to an earlier revision.
 */
export function createFilesystemRunStore(rootDir: string): RunStore {
  const dirFor = (runId: RunId): string => path.join(rootDir, runId.replace(/[^a-z0-9]/gi, '_'));

  const ensureDir = (dir: string): void => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  };

  const headVersion = (dir: string): number => {
    if (!existsSync(dir)) return -1;
    const versions = readdirSync(dir)
      .map((file) => /^record-v(\d+)\.json$/.exec(file))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number.parseInt(match[1]!, 10));
    return versions.length === 0 ? -1 : Math.max(...versions);
  };

  const readVersion = (dir: string, version: number): CanonicalRunRecord => {
    const file = path.join(dir, `record-v${version}.json`);
    return decodeCanonicalRunRecord(JSON.parse(readFileSync(file, 'utf8')));
  };

  const publish = (dir: string, record: CanonicalRunRecord): void => {
    ensureDir(dir);
    const file = path.join(dir, `record-v${record.recordVersion}.json`);
    // `wx` = O_EXCL: fails if the file already exists (immutable publication).
    writeFileSync(file, JSON.stringify(record, null, 0), { flag: 'wx' });
  };

  return Object.freeze({
    create(runId: RunId, initial: CanonicalRunRecord): void {
      const dir = dirFor(runId);
      if (headVersion(dir) !== -1) {
        throw new RunStoreError(
          'run_already_exists',
          'A Run with this RunId already exists in the store.'
        );
      }
      publish(dir, initial);
    },
    load(runId: RunId): CanonicalRunRecord {
      const dir = dirFor(runId);
      const version = headVersion(dir);
      if (version === -1) {
        throw new RunStoreError('run_not_found', 'No Run with this RunId.');
      }
      return readVersion(dir, version);
    },
    commit(runId: RunId, next: CanonicalRunRecord): void {
      const dir = dirFor(runId);
      const version = headVersion(dir);
      if (version === -1) {
        throw new RunStoreError('run_not_found', 'Cannot commit to an absent Run.');
      }
      const head = readVersion(dir, version);
      if (next.recordVersion !== head.recordVersion + 1) {
        throw new RunStoreError(
          'run_record_version_gap',
          'Committed Record version must be exactly head + 1.'
        );
      }
      if (next.previousRecordDigest !== digestCanonicalRunRecord(head)) {
        throw new RunStoreError(
          'run_record_predecessor_mismatch',
          'Committed Record predecessor digest must equal the head digest.'
        );
      }
      publish(dir, next);
    },
    has(runId: RunId): boolean {
      return headVersion(dirFor(runId)) !== -1;
    },
    list(): readonly RunSummary[] {
      if (!existsSync(rootDir)) return [];
      const summaries: RunSummary[] = [];
      for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(rootDir, entry.name);
        const version = headVersion(dir);
        if (version === -1) continue;
        try {
          const record = readVersion(dir, version);
          summaries.push(
            Object.freeze({
              runId: record.runId,
              recordVersion: record.recordVersion,
              status: record.status,
              terminal: record.terminal,
            })
          );
        } catch {
          // An unreadable revision is isolated; it does not abort the listing.
        }
      }
      return summaries;
    },
  });
}
