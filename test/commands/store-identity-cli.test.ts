import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ensureCliBuilt, runCLI } from '../helpers/run-cli.js';
import { snapshotDirectory } from '../helpers/fs-snapshot.js';

/**
 * End-to-end proof of the two contracts that are only observable from the
 * outside: read-only commands write nothing, and human/JSON output agree on
 * codes and repairs.
 */
describe('store identity CLI surface', () => {
  let tempDir: string;
  let machineHome: string;
  let storeRoot: string;
  let projectRoot: string;

  beforeAll(async () => {
    await ensureCliBuilt();
  }, 180_000);

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rasen-identity-cli-'));
    machineHome = path.join(tempDir, 'machine');
    fs.mkdirSync(machineHome, { recursive: true });

    storeRoot = path.join(tempDir, 'team-store');
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(storeRoot, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(storeRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    fs.mkdirSync(path.join(storeRoot, '.rasen-store'), { recursive: true });
    // Legacy metadata on purpose: the read-only proof must hold for a store
    // that predates permanent identities.
    fs.writeFileSync(
      path.join(storeRoot, '.rasen-store', 'store.yaml'),
      'version: 1\nid: team-store\n'
    );

    projectRoot = path.join(tempDir, 'project');
    fs.mkdirSync(path.join(projectRoot, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'rasen', 'changes', 'archive'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function env(): NodeJS.ProcessEnv {
    return { RASEN_HOME: machineHome, RASEN_LANG: 'en' };
  }

  interface RegistrationPayload {
    store: { id: string; root: string } | null;
    status: Array<{ severity: string; code: string; message: string; fix?: string }>;
  }

  function writeProjectStoreDeclaration(value: string): void {
    fs.writeFileSync(
      path.join(projectRoot, 'rasen', 'config.yaml'),
      `schema: spec-driven\nstore: ${value}\n`
    );
  }

  async function registerStore(): Promise<void> {
    const result = await runCLI(['store', 'register', storeRoot, '--yes', '--json'], {
      cwd: tempDir,
      env: env(),
    });
    expect(result.exitCode, result.stderr || result.stdout).toBe(0);
  }

  it('leaves the store metadata and the registry byte-identical across every read-only command', async () => {
    await registerStore();
    writeProjectStoreDeclaration('team-store');

    const before = {
      store: snapshotDirectory(storeRoot),
      machine: snapshotDirectory(machineHome),
    };

    const readOnly: string[][] = [
      ['doctor', '--json'],
      ['store', 'doctor', '--json'],
      ['store', 'list', '--json'],
      ['list', '--json'],
      ['status', '--json'],
    ];

    for (const args of readOnly) {
      await runCLI(args, { cwd: projectRoot, env: env() });
    }
    await runCLI(['show', 'team-store', '--json'], { cwd: projectRoot, env: env() });

    expect(snapshotDirectory(storeRoot)).toEqual(before.store);
    expect(snapshotDirectory(machineHome)).toEqual(before.machine);
  }, 180_000);

  it('reports an unavailable declared store in doctor and keeps running', async () => {
    writeProjectStoreDeclaration('nowhere');

    const json = await runCLI(['doctor', '--json'], { cwd: projectRoot, env: env() });
    const payload = JSON.parse(json.stdout) as {
      store: {
        id: string;
        unavailable?: { reason: string; repair: string[] };
        status: Array<{ code: string; message: string; fix?: string }>;
      } | null;
    };

    expect(payload.store).not.toBeNull();
    expect(payload.store?.unavailable?.reason).toBe('not-registered');
    expect(payload.store?.status.map((entry) => entry.code)).toContain(
      'store_bootstrap_required'
    );
    expect(payload.store?.unavailable?.repair[0]).toContain('rasen store register');
  }, 120_000);

  it('agrees between human and JSON output on codes and repair commands', async () => {
    writeProjectStoreDeclaration('nowhere');

    const json = await runCLI(['doctor', '--json'], { cwd: projectRoot, env: env() });
    const human = await runCLI(['doctor'], { cwd: projectRoot, env: env() });

    const payload = JSON.parse(json.stdout) as {
      store: { status: Array<{ message: string; fix?: string }> } | null;
    };
    const findings = payload.store?.status ?? [];
    expect(findings.length).toBeGreaterThan(0);

    for (const finding of findings) {
      expect(human.stdout).toContain(finding.message);
      if (finding.fix) {
        expect(human.stdout).toContain(finding.fix);
      }
    }
  }, 120_000);

  it('stops a project-scoped config read whose declared store is unavailable', async () => {
    writeProjectStoreDeclaration('nowhere');

    // The effective (project-scoped) view resolves the store layer, so it must
    // stop rather than report global/default values as though the project had
    // no store.
    const scoped = await runCLI(['config'], { cwd: projectRoot, env: env() });
    expect(scoped.exitCode).not.toBe(0);
    const output = `${scoped.stdout}${scoped.stderr}`;
    expect(output).toMatch(/not registered on this machine/i);
    expect(output).toContain('rasen store register');

    // The machine scope has no project layer, so no store layer applies: it
    // keeps working (design D4's carve-out).
    const global = await runCLI(['config', 'list', '--scope', 'global'], {
      cwd: projectRoot,
      env: env(),
    });
    expect(global.exitCode, global.stderr).toBe(0);
  }, 120_000);

  it('exits non-zero from both doctors while still reporting the diagnosis', async () => {
    writeProjectStoreDeclaration('nowhere');

    const results = {
      doctorJson: await runCLI(['doctor', '--json'], { cwd: projectRoot, env: env() }),
      doctorHuman: await runCLI(['doctor'], { cwd: projectRoot, env: env() }),
      storeDoctorJson: await runCLI(['store', 'doctor', '--json'], { cwd: projectRoot, env: env() }),
      storeDoctorHuman: await runCLI(['store', 'doctor'], { cwd: projectRoot, env: env() }),
    };

    // A wrapper or CI step gating on either doctor's exit status must not read
    // "healthy" in the exact state these commands exist to make loud.
    for (const [name, result] of Object.entries(results)) {
      expect(result.exitCode, `${name}: ${result.stdout}${result.stderr}`).toBe(1);
    }

    // Non-zero is not failing closed: the full diagnosis is still reported.
    const doctorPayload = JSON.parse(results.doctorJson.stdout) as {
      store: { unavailable?: { reason: string; repair: string[] } } | null;
    };
    expect(doctorPayload.store?.unavailable?.reason).toBe('not-registered');
    expect(results.doctorHuman.stdout).toContain('not available on this machine');

    const storePayload = JSON.parse(results.storeDoctorJson.stdout) as {
      projectStore: { reason: string; repair: string[]; status: Array<{ code: string }> } | null;
    };
    expect(storePayload.projectStore?.reason).toBe('not-registered');
    expect(storePayload.projectStore?.status.map((entry) => entry.code)).toContain(
      'store_bootstrap_required'
    );
    expect(results.storeDoctorHuman.stdout).toContain('Not available on this machine');
  }, 180_000);

  it('keeps machine scope readable and fails project scope with a rendered error', async () => {
    writeProjectStoreDeclaration('nowhere');

    // Machine scope resolves no project layer, so no store layer applies.
    const machine = await runCLI(['config', '--scope', 'global'], {
      cwd: projectRoot,
      env: env(),
    });
    expect(machine.exitCode, machine.stderr).toBe(0);

    // Project scope fails closed — through the standard Error:/Fix: rendering,
    // never as an unhandled rejection dumping internal paths.
    const project = await runCLI(['config'], { cwd: projectRoot, env: env() });
    expect(project.exitCode).toBe(1);
    expect(project.stderr).toContain('Error:');
    expect(project.stderr).toContain('Fix:');
    expect(project.stderr).not.toContain('StoreError:');
    expect(project.stderr).not.toMatch(/\bat \w+ \(/u);
  }, 120_000);

  describe('two stores sharing a display name', () => {
    let twinRoot: string;
    let firstUid: string;
    const twinUid = '3f1c9f2e-6c2a-4d7b-9c1a-8b7d6e5f4a3b';

    /** A healthy store root carrying its own permanent identity and `id`. */
    function makeIdentifiedStore(name: string, uid: string, id: string): string {
      const root = path.join(tempDir, name);
      fs.mkdirSync(path.join(root, 'rasen', 'specs'), { recursive: true });
      fs.mkdirSync(path.join(root, 'rasen', 'changes', 'archive'), { recursive: true });
      fs.writeFileSync(path.join(root, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      fs.mkdirSync(path.join(root, '.rasen-store'), { recursive: true });
      fs.writeFileSync(
        path.join(root, '.rasen-store', 'store.yaml'),
        `version: 2\nuid: ${uid}\nid: ${id}\n`
      );
      return root;
    }

    async function registerTwins(): Promise<void> {
      await registerStore();
      const upgraded = await runCLI(
        ['store', 'upgrade-identity', 'team-store', '--apply', '--json'],
        { cwd: tempDir, env: env() }
      );
      expect(upgraded.exitCode, upgraded.stderr).toBe(0);
      firstUid = (JSON.parse(upgraded.stdout) as { store: { uid: string } }).store.uid;

      twinRoot = makeIdentifiedStore('team-store-twin', twinUid, 'team-store');

      const registered = await runCLI(['store', 'register', twinRoot, '--yes', '--json'], {
        cwd: tempDir,
        env: env(),
      });
      expect(registered.exitCode, registered.stdout || registered.stderr).toBe(0);
      lastRegistration = JSON.parse(registered.stdout) as RegistrationPayload;
    }

    let lastRegistration: RegistrationPayload;

    it('reports ambiguity with a placeholder repair, never a chosen candidate', async () => {
      await registerTwins();
      writeProjectStoreDeclaration('team-store');

      const doctor = await runCLI(['store', 'doctor', '--json'], {
        cwd: projectRoot,
        env: env(),
      });
      const payload = JSON.parse(doctor.stdout) as {
        projectStore: { reason: string; repair: string[]; status: Array<{ code: string; message: string; fix?: string }> } | null;
      };

      expect(payload.projectStore?.reason).toBe('alias-ambiguous');
      const ambiguous = payload.projectStore?.status.find(
        (entry) => entry.code === 'store_alias_ambiguous'
      );
      // Pasting the printed repair must not durably rebind the project to
      // whichever candidate happened to sort first.
      expect(ambiguous?.fix).toContain('--uid <identity>');
      expect(ambiguous?.fix).not.toContain(firstUid);
      expect(ambiguous?.fix).not.toContain('3f1c9f2e-6c2a-4d7b-9c1a-8b7d6e5f4a3b');
      // Both candidates are still named, with what tells them apart.
      expect(ambiguous?.message).toContain(firstUid);
      expect(ambiguous?.message).toContain('3f1c9f2e-6c2a-4d7b-9c1a-8b7d6e5f4a3b');
      expect(payload.projectStore?.repair[0]).toContain('--uid <identity>');
    }, 180_000);

    it('selects a store by permanent identity when the display name is ambiguous', async () => {
      await registerTwins();

      const byName = await runCLI(['list', '--store', 'team-store', '--json'], {
        cwd: tempDir,
        env: env(),
      });
      expect(byName.exitCode).toBe(1);
      const nameOutput = `${byName.stdout}${byName.stderr}`;
      expect(nameOutput).toContain('matches 2 registered stores');
      // The suggested repair has to be one that works on THIS surface:
      // upgrade-identity rewrites a project declaration and does nothing for
      // a --store flag.
      expect(nameOutput).not.toContain('upgrade-identity');

      const byIdentity = await runCLI(['list', '--store', firstUid, '--json'], {
        cwd: tempDir,
        env: env(),
      });
      expect(byIdentity.exitCode, byIdentity.stdout || byIdentity.stderr).toBe(0);

      const twinByIdentity = await runCLI(
        ['list', '--store', '3f1c9f2e-6c2a-4d7b-9c1a-8b7d6e5f4a3b', '--json'],
        { cwd: tempDir, env: env() }
      );
      expect(twinByIdentity.exitCode, twinByIdentity.stdout || twinByIdentity.stderr).toBe(0);
    }, 180_000);

    it('warns, on both surfaces, that the display name has become ambiguous', async () => {
      await registerTwins();

      // The registration that CREATED the ambiguity says so — otherwise the
      // machine enters a state every downstream surface then refuses to
      // resolve, and the user finds out from an unrelated command.
      const repeated = lastRegistration.status.find(
        (entry) => entry.code === 'store_alias_repeated'
      );
      expect(repeated, JSON.stringify(lastRegistration.status)).toBeDefined();
      expect(repeated?.severity).toBe('warning');
      expect(repeated?.message).toContain('matches 2 registered stores');
      expect(repeated?.message).toContain(twinUid);
      expect(repeated?.fix).toContain('uid');

      // Human mode carries the same warning, not only --json.
      const third = makeIdentifiedStore(
        'team-store-third',
        '7c2d1a08-9f43-4a51-b8e2-0d6c3f1b2e94',
        'team-store'
      );
      const human = await runCLI(['store', 'register', third, '--yes'], {
        cwd: tempDir,
        env: env(),
      });
      expect(human.exitCode, human.stderr).toBe(0);
      expect(human.stdout).toContain('matches 3 registered stores');
    }, 180_000);

    it('unregisters by permanent identity, and refuses the ambiguous name', async () => {
      await registerTwins();

      // The name alone must not decide which registration disappears.
      const byName = await runCLI(['store', 'unregister', 'team-store', '--json'], {
        cwd: tempDir,
        env: env(),
      });
      expect(byName.exitCode).toBe(1);
      const nameStatus = (JSON.parse(byName.stdout) as RegistrationPayload).status[0];
      expect(nameStatus?.code).toBe('store_alias_ambiguous');
      expect(nameStatus?.fix).toContain('permanent identity');

      // The identity is exact — and is the only thing that can name a twin.
      const byIdentity = await runCLI(['store', 'unregister', twinUid, '--json'], {
        cwd: tempDir,
        env: env(),
      });
      expect(byIdentity.exitCode, byIdentity.stdout || byIdentity.stderr).toBe(0);

      // Exactly the named one is gone; the other survives untouched.
      const listed = await runCLI(['store', 'list', '--json'], { cwd: tempDir, env: env() });
      const stores = (JSON.parse(listed.stdout) as { stores: Array<{ uid?: string }> }).stores;
      expect(stores.map((store) => store.uid)).toContain(firstUid);
      expect(stores.map((store) => store.uid)).not.toContain(twinUid);
      expect(fs.existsSync(twinRoot)).toBe(true);
    }, 180_000);

    it('diagnoses one twin by permanent identity', async () => {
      await registerTwins();

      const doctored = await runCLI(['store', 'doctor', twinUid, '--json'], {
        cwd: tempDir,
        env: env(),
      });
      expect(doctored.exitCode, doctored.stdout || doctored.stderr).toBe(0);
      const payload = JSON.parse(doctored.stdout) as { stores: Array<{ id: string; uid?: string }> };
      expect(payload.stores).toHaveLength(1);
      expect(payload.stores[0]?.uid).toBe(twinUid);
      expect(payload.stores[0]?.id).toBe('team-store');
    }, 180_000);

    it('reports the display-name rename that re-registering performs', async () => {
      await registerTwins();

      // D11's only rename path: edit the store's own metadata, re-register.
      fs.writeFileSync(
        path.join(twinRoot, '.rasen-store', 'store.yaml'),
        `version: 2\nuid: ${twinUid}\nid: renamed-store\n`
      );
      const renamed = await runCLI(['store', 'register', twinRoot, '--yes', '--json'], {
        cwd: tempDir,
        env: env(),
      });
      expect(renamed.exitCode, renamed.stderr).toBe(0);

      const notice = (JSON.parse(renamed.stdout) as RegistrationPayload).status.find(
        (entry) => entry.code === 'store_alias_renamed'
      );
      expect(notice, renamed.stdout).toBeDefined();
      expect(notice?.message).toContain('team-store');
      expect(notice?.message).toContain('renamed-store');
      expect(notice?.message).toContain(twinUid);
    }, 180_000);

    it('refuses store setup on a repeated name without naming an arbitrary incumbent', async () => {
      await registerTwins();

      const setup = await runCLI(
        ['store', 'setup', 'team-store', '--path', path.join(tempDir, 'yet-another'), '--no-init-git', '--json'],
        { cwd: tempDir, env: env() }
      );

      expect(setup.exitCode).toBe(1);
      const status = (JSON.parse(setup.stdout) as RegistrationPayload).status[0];
      expect(status?.code).toBe('store_id_conflict');
      // Naming one of the twins as "the" conflict would be a lie, and
      // `unregister team-store` would itself be ambiguous.
      expect(status?.message).toContain("2 registered stores already use the name 'team-store'");
      expect(status?.fix).not.toContain('unregister team-store');
      expect(status?.fix).toContain('permanent identity');
    }, 180_000);

    it('adds a project to a store named by permanent identity', async () => {
      await registerTwins();

      const memberRepo = path.join(tempDir, 'member-repo');
      fs.mkdirSync(path.join(memberRepo, 'rasen', 'specs'), { recursive: true });
      fs.mkdirSync(path.join(memberRepo, 'rasen', 'changes', 'archive'), { recursive: true });
      fs.writeFileSync(path.join(memberRepo, 'rasen', 'config.yaml'), 'schema: spec-driven\n');

      const added = await runCLI(
        ['store', 'add-project', memberRepo, '--to', twinUid, '--as', 'member-repo', '--json'],
        { cwd: tempDir, env: env() }
      );

      // Resolving by identity must not then verify the checkout's metadata
      // against the uid: that reports a metadata/registry mismatch that does
      // not exist and tells the user to repair two correct files.
      expect(added.exitCode, added.stdout || added.stderr).toBe(0);
      const payload = JSON.parse(added.stdout) as { target: { id: string; root: string } };
      // The RESOLVED display name is reported, not the identity that was typed.
      expect(payload.target.id).toBe('team-store');
      expect(payload.target.root).toBe(twinRoot);
      // The reference landed in the store the identity named, not its twin.
      expect(fs.readFileSync(path.join(twinRoot, 'rasen', 'config.yaml'), 'utf-8')).toContain(
        'member-repo'
      );
    }, 180_000);

    it('adopts into a store named by permanent identity, recording a resolvable declaration', async () => {
      await registerTwins();

      const appRepo = path.join(tempDir, 'app-repo');
      fs.mkdirSync(path.join(appRepo, 'rasen', 'specs', 'billing'), { recursive: true });
      fs.mkdirSync(path.join(appRepo, 'rasen', 'changes', 'archive'), { recursive: true });
      fs.writeFileSync(path.join(appRepo, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
      fs.writeFileSync(
        path.join(appRepo, 'rasen', 'specs', 'billing', 'spec.md'),
        '## Purpose\n\nBilling.\n'
      );

      const adopted = await runCLI(
        ['store', 'adopt', appRepo, '--to', twinUid, '--json'],
        { cwd: tempDir, env: env() }
      );
      expect(adopted.exitCode, adopted.stdout || adopted.stderr).toBe(0);
      const payload = JSON.parse(adopted.stdout) as {
        adopt: { store: string; store_root: string; project_id: string };
      };
      // The report names the resolved store, not the identity that was typed.
      expect(payload.adopt.store).toBe('team-store');
      expect(payload.adopt.store_root).toBe(twinRoot);

      // THE assertion that matters: the adopted repo must actually work. This
      // fixture has two stores named 'team-store', so a declaration recording
      // only that name — the best a bare string can do — resolves as ambiguous
      // and every command in the repo fails. The file is Git-tracked and adopt
      // prints a commit hint for it, so the wrong form gets shared.
      const worksAfterAdopt = await runCLI(['list', '--json'], { cwd: appRepo, env: env() });
      expect(
        worksAfterAdopt.exitCode,
        worksAfterAdopt.stdout || worksAfterAdopt.stderr
      ).toBe(0);

      // Which requires the durable object form: the identity is what says
      // WHICH twin, and the display name rides along for readability.
      const declaration = fs.readFileSync(path.join(appRepo, 'rasen', 'config.yaml'), 'utf-8');
      expect(declaration).toContain(`uid: ${twinUid}`);
      expect(declaration).toContain('id: team-store');

      // …and the round trip: eject accepts the identity too, and reports the
      // resolved name rather than echoing the uid back.
      const ejected = await runCLI(
        ['store', 'eject', payload.adopt.project_id, '--from', twinUid, '--json'],
        { cwd: tempDir, env: env() }
      );
      expect(ejected.exitCode, ejected.stdout || ejected.stderr).toBe(0);
      const ejectPayload = JSON.parse(ejected.stdout) as { eject: { store: string } };
      expect(ejectPayload.eject.store).toBe('team-store');
      expect(fs.existsSync(path.join(appRepo, 'rasen', 'specs', 'billing'))).toBe(true);
      // Eject removes the declaration outright, so the repo is Store-less
      // again — and still works, whatever form the declaration had.
      expect(
        fs.readFileSync(path.join(appRepo, 'rasen', 'config.yaml'), 'utf-8')
      ).not.toContain(twinUid);
      const worksAfterEject = await runCLI(['list', '--json'], { cwd: appRepo, env: env() });
      expect(worksAfterEject.exitCode, worksAfterEject.stdout || worksAfterEject.stderr).toBe(0);
    }, 180_000);

    it('accepts a permanent identity as the upgrade-identity operand', async () => {
      await registerTwins();

      const upgraded = await runCLI(['store', 'upgrade-identity', twinUid, '--json'], {
        cwd: tempDir,
        env: env(),
      });

      // Reporting a registered store as "unknown" because the user named it by
      // the one thing that identifies it exactly is the defect this closes.
      expect(upgraded.exitCode, upgraded.stdout || upgraded.stderr).toBe(0);
      const payload = JSON.parse(upgraded.stdout) as {
        store: { id: string; uid: string; root: string };
      };
      expect(payload.store.uid).toBe(twinUid);
      // …and the report names the store, not the identity that was typed.
      expect(payload.store.id).toBe('team-store');
      expect(payload.store.root).toBe(twinRoot);
    }, 180_000);

    it('tells two same-named stores apart when reporting an unknown one', async () => {
      await registerTwins();

      const unknown = await runCLI(['list', '--store', 'no-such-store', '--json'], {
        cwd: tempDir,
        env: env(),
      });
      const output = `${unknown.stdout}${unknown.stderr}`;
      expect(unknown.exitCode).toBe(1);
      // "Registered stores: team-store, team-store." tells the reader nothing.
      expect(output).toContain(firstUid);
      expect(output).toContain('3f1c9f2e-6c2a-4d7b-9c1a-8b7d6e5f4a3b');
    }, 180_000);
  });

  it('reports which entries keep the registry keyed by display name', async () => {
    const registered = await runCLI(['store', 'register', storeRoot, '--yes', '--json'], {
      cwd: tempDir,
      env: env(),
    });

    expect(registered.exitCode, registered.stderr).toBe(0);
    const payload = JSON.parse(registered.stdout) as {
      status: Array<{ code: string; message: string; fix?: string }>;
    };
    // The re-key was refused rather than inventing an identity — the command
    // that ran the mutation says which entry blocks it, instead of leaving the
    // registry quietly alias-keyed with nothing said.
    const blocked = payload.status.find(
      (entry) => entry.code === 'store_registry_rekey_blocked'
    );
    expect(blocked, JSON.stringify(payload.status)).toBeDefined();
    expect(blocked?.message).toContain('team-store');
    expect(blocked?.fix).toContain('rasen store upgrade-identity');
  }, 120_000);

  it('previews exactly what the identity upgrade then writes', async () => {
    await registerStore();

    // A second store that still predates permanent identities: it is what
    // blocks the registry re-key, and the preview has to say so.
    const otherRoot = path.join(tempDir, 'other-store');
    fs.mkdirSync(path.join(otherRoot, 'rasen', 'specs'), { recursive: true });
    fs.mkdirSync(path.join(otherRoot, 'rasen', 'changes', 'archive'), { recursive: true });
    fs.writeFileSync(path.join(otherRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    fs.mkdirSync(path.join(otherRoot, '.rasen-store'), { recursive: true });
    fs.writeFileSync(
      path.join(otherRoot, '.rasen-store', 'store.yaml'),
      'version: 1\nid: other-store\n'
    );
    const registeredOther = await runCLI(['store', 'register', otherRoot, '--yes', '--json'], {
      cwd: tempDir,
      env: env(),
    });
    expect(registeredOther.exitCode, registeredOther.stderr).toBe(0);

    const preview = await runCLI(['store', 'upgrade-identity', 'team-store', '--json'], {
      cwd: tempDir,
      env: env(),
    });
    expect(preview.exitCode, preview.stderr).toBe(0);
    const previewPayload = JSON.parse(preview.stdout) as {
      steps: Array<{ target: string; blocked?: string }>;
    };
    const registryStep = previewPayload.steps.find((step) => step.target === 'registry');
    // The store being upgraded is NOT one of the blockers (it carries an
    // identity by the time the registry step runs); the other one is.
    expect(registryStep?.blocked).toBeDefined();
    expect(registryStep?.blocked).toContain('other-store');
    expect(registryStep?.blocked).not.toContain('team-store');

    const applied = await runCLI(
      ['store', 'upgrade-identity', 'team-store', '--apply', '--json'],
      { cwd: tempDir, env: env() }
    );
    expect(applied.exitCode, applied.stderr).toBe(0);
    const appliedPayload = JSON.parse(applied.stdout) as { repair_needed: string[] };
    // Same fact, same sentence: the plan matched what the apply then wrote.
    expect(appliedPayload.repair_needed).toContain(registryStep?.blocked);
  }, 180_000);

  it('previews and applies the identity upgrade from the CLI', async () => {
    await registerStore();
    writeProjectStoreDeclaration('team-store');

    const before = snapshotDirectory(storeRoot);
    const preview = await runCLI(
      ['store', 'upgrade-identity', 'team-store', '--json'],
      { cwd: projectRoot, env: env() }
    );
    expect(preview.exitCode, preview.stderr).toBe(0);
    const previewPayload = JSON.parse(preview.stdout) as {
      applied: boolean;
      steps: Array<{ target: string }>;
    };
    expect(previewPayload.applied).toBe(false);
    expect(previewPayload.steps.map((step) => step.target)).toContain('store-metadata');
    expect(snapshotDirectory(storeRoot)).toEqual(before);

    const applied = await runCLI(
      ['store', 'upgrade-identity', 'team-store', '--apply', '--json'],
      { cwd: projectRoot, env: env() }
    );
    expect(applied.exitCode, applied.stderr).toBe(0);
    const appliedPayload = JSON.parse(applied.stdout) as {
      applied: boolean;
      store: { uid: string };
      files_to_commit: string[];
    };
    expect(appliedPayload.applied).toBe(true);
    expect(appliedPayload.files_to_commit.length).toBeGreaterThan(0);

    const metadata = fs.readFileSync(
      path.join(storeRoot, '.rasen-store', 'store.yaml'),
      'utf-8'
    );
    expect(metadata).toContain('version: 2');
    expect(metadata).toContain(appliedPayload.store.uid);

    const declaration = fs.readFileSync(
      path.join(projectRoot, 'rasen', 'config.yaml'),
      'utf-8'
    );
    expect(declaration).toContain(`uid: ${appliedPayload.store.uid}`);
  }, 180_000);
});
