import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { getGlobalDataDir } from '../../../src/core/index.js';
import { registerExistingStore } from '../../../src/core/store/operations.js';
import {
  getStoreRegistryPath,
  readStoreRegistryState,
  writeStoreMetadataState,
} from '../../../src/core/store/foundation.js';
import { mintStoreUid } from '../../../src/core/store/identity-types.js';
import { createOpenSpecRoot } from '../../helpers/rasen-fixtures.js';

let tempDir: string;
let savedXdg: string | undefined;
let savedRasenHome: string | undefined;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-register-datadir-'));
  savedXdg = process.env.XDG_DATA_HOME;
  savedRasenHome = process.env.RASEN_HOME;
  delete process.env.RASEN_HOME;
  process.env.XDG_DATA_HOME = path.join(tempDir, 'default-data');
});

afterEach(() => {
  if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = savedXdg;
  if (savedRasenHome === undefined) delete process.env.RASEN_HOME;
  else process.env.RASEN_HOME = savedRasenHome;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function makeStoreCheckout(name: string, parent: string): string {
  const root = path.join(parent, name);
  createOpenSpecRoot(root);
  return root;
}

describe('M2 — registerExistingStore threads globalDataDir (A≠B three-path)', () => {
  it('registers to A, not default; B is disjoint; default is disjoint', async () => {
    const dirA = path.join(tempDir, 'dataA');
    const dirB = path.join(tempDir, 'dataB');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    const defaultDataDir = getGlobalDataDir({ env: process.env });

    // Path 1: register a store into A.
    const storeRootA = makeStoreCheckout('store-a', tempDir);
    const uidA = mintStoreUid();
    await writeStoreMetadataState(storeRootA, { version: 2, uid: uidA, id: 'store-a' });
    await registerExistingStore({ path: storeRootA, globalDataDir: dirA });

    const registryA = await readStoreRegistryState({ globalDataDir: dirA });
    expect(registryA).not.toBeNull();
    expect(registryA!.stores).toHaveProperty(uidA);

    // A's registry has the entry; default's does not.
    const registryDefault1 = await readStoreRegistryState({});
    expect(registryDefault1).toBeNull();

    // Path 2: register a DIFFERENT store into B.
    const storeRootB = makeStoreCheckout('store-b', tempDir);
    const uidB = mintStoreUid();
    await writeStoreMetadataState(storeRootB, { version: 2, uid: uidB, id: 'store-b' });
    await registerExistingStore({ path: storeRootB, globalDataDir: dirB });

    const registryB = await readStoreRegistryState({ globalDataDir: dirB });
    expect(registryB).not.toBeNull();
    expect(registryB!.stores).toHaveProperty(uidB);
    expect(registryB!.stores).not.toHaveProperty(uidA);

    // A is unchanged.
    const registryA2 = await readStoreRegistryState({ globalDataDir: dirA });
    expect(registryA2!.stores).toHaveProperty(uidA);
    expect(registryA2!.stores).not.toHaveProperty(uidB);

    // Default still empty.
    const registryDefault2 = await readStoreRegistryState({});
    expect(registryDefault2).toBeNull();

    // Path 3: register into default (no globalDataDir option).
    const storeRootDefault = makeStoreCheckout('store-default', tempDir);
    const uidDefault = mintStoreUid();
    await writeStoreMetadataState(storeRootDefault, {
      version: 2,
      uid: uidDefault,
      id: 'store-default',
    });
    await registerExistingStore({ path: storeRootDefault });

    const registryDefault3 = await readStoreRegistryState({});
    expect(registryDefault3).not.toBeNull();
    expect(registryDefault3!.stores).toHaveProperty(uidDefault);

    // A and B are unchanged.
    const registryA3 = await readStoreRegistryState({ globalDataDir: dirA });
    expect(registryA3!.stores).toHaveProperty(uidA);
    expect(registryA3!.stores).not.toHaveProperty(uidDefault);
    const registryB3 = await readStoreRegistryState({ globalDataDir: dirB });
    expect(registryB3!.stores).toHaveProperty(uidB);
    expect(registryB3!.stores).not.toHaveProperty(uidDefault);

    // Physical paths are disjoint too.
    expect(getStoreRegistryPath({ globalDataDir: dirA })).not.toBe(
      getStoreRegistryPath({ globalDataDir: dirB })
    );
    expect(getStoreRegistryPath({ globalDataDir: dirA })).not.toBe(
      getStoreRegistryPath({})
    );
  });
});
