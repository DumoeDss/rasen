import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock @inquirer/prompts for the interactive config editor (task 7.4).
// `Separator` must stay a real constructable class — `runInteractiveConfigEditor`
// does `new Separator(...)` to build group headers in the choices array.
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  input: vi.fn(),
  Separator: class Separator {
    separator?: string;
    constructor(separator?: string) {
      this.separator = separator;
    }
  },
}));

async function runConfigCommand(args: string[]): Promise<void> {
  const { registerConfigCommand } = await import('../../src/commands/config.js');
  const program = new Command();
  registerConfigCommand(program);
  await program.parseAsync(['node', 'rasen', 'config', ...args]);
}

async function getPromptMocks(): Promise<{
  select: ReturnType<typeof vi.fn>;
  input: ReturnType<typeof vi.fn>;
}> {
  const prompts = await import('@inquirer/prompts');
  return {
    select: prompts.select as unknown as ReturnType<typeof vi.fn>,
    input: prompts.input as unknown as ReturnType<typeof vi.fn>,
  };
}

interface Choice {
  value: string;
  name: string;
  description?: string;
  disabled?: boolean | string;
}

/** Flattens one select() call's choices array, dropping Separator rows. */
async function choicesFromCall(callIndex: number): Promise<Choice[]> {
  const { select } = await getPromptMocks();
  const arg = select.mock.calls[callIndex][0] as { choices: unknown[] };
  return arg.choices.filter((c): c is Choice => typeof c === 'object' && c !== null && 'value' in c) as Choice[];
}

describe('config editor (interactive, --no-arg TTY) (task 7.4)', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let originalCwd: string;
  let originalTTY: boolean | undefined;
  let originalExitCode: number | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempDir = fs.realpathSync(
      fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'rasen-config-editor-test-'))
    );

    originalEnv = { ...process.env };
    originalCwd = process.cwd();
    originalTTY = (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
    originalExitCode = process.exitCode;

    delete process.env.RASEN_HOME;
    process.env.XDG_CONFIG_HOME = tempDir;
    delete process.env.RASEN_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
    delete process.env.CI;
    process.env.RASEN_LANG = 'en';
    process.chdir(tempDir); // outside any Rasen project by default
    (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = true;
    process.exitCode = undefined;

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    process.chdir(originalCwd);
    (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = originalTTY;
    process.exitCode = originalExitCode;
    fs.rmSync(tempDir, { recursive: true, force: true });

    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    vi.resetModules();
  });

  function makeProject(): string {
    const projectRoot = path.join(tempDir, 'project');
    fs.mkdirSync(path.join(projectRoot, 'rasen'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'schema: spec-driven\n');
    process.chdir(projectRoot);
    return projectRoot;
  }

  it('shows every registry key grouped by area with its effective value and source, then exits cleanly', async () => {
    const { select } = await getPromptMocks();
    select.mockResolvedValueOnce('__exit__');

    await runConfigCommand([]);

    expect(select).toHaveBeenCalledTimes(1);
    const choices = await choicesFromCall(0);

    const proactiveRow = choices.find((c) => c.value === 'proactive')!;
    expect(proactiveRow.name).toContain('proactive = true');
    expect(proactiveRow.name).toContain('default');

    const exitRow = choices.find((c) => c.value === '__exit__');
    expect(exitRow).toBeTruthy();
    expect(process.exitCode).not.toBe(1);
    expect(process.exitCode).not.toBe(130);
  });

  it('localizes config groups and descriptions in Japanese', async () => {
    const { select } = await getPromptMocks();
    process.env.RASEN_LANG = 'ja';
    select.mockResolvedValueOnce('__exit__');

    await runConfigCommand([]);

    const choices = await choicesFromCall(0);
    const languageRow = choices.find((choice) => choice.value === 'language')!;
    expect(languageRow.name).toContain('表示 / language = ja');
    expect(languageRow.name).toContain('環境変数による上書き');
    expect(languageRow.name).toContain('環境変数の値が優先されます');
    expect(languageRow.description).toContain('対話プロンプトとCLIヘルプの言語');
    expect(choices.find((choice) => choice.value === '__exit__')?.name).toBe('終了');
    expect(select.mock.calls[0][0].message).toBe('編集する項目を選択:');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Rasen設定'));
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Rasenプロジェクト外のため')
    );
  });

  it('the workflows row is a disabled pointer to `rasen profile`', async () => {
    const { select } = await getPromptMocks();
    select.mockResolvedValueOnce('__exit__');

    await runConfigCommand([]);

    const choices = await choicesFromCall(0);
    const workflowsRow = choices.find((c) => c.value === '__workflows__')!;
    expect(workflowsRow.disabled).toBeTruthy();
    expect(String(workflowsRow.disabled)).toContain('rasen profile');
  });

  it('project-only keys are disabled outside a Rasen project', async () => {
    const { select } = await getPromptMocks();
    select.mockResolvedValueOnce('__exit__');

    await runConfigCommand([]);

    const choices = await choicesFromCall(0);
    const gatesRow = choices.find((c) => c.value === 'autopilot.gates')!;
    expect(gatesRow.disabled).toBeTruthy();
    expect(String(gatesRow.disabled)).toContain('requires a Rasen project');
  });

  it('project-only keys are editable inside a Rasen project (not disabled)', async () => {
    makeProject();
    const { select } = await getPromptMocks();
    select.mockResolvedValueOnce('__exit__');

    await runConfigCommand([]);

    const choices = await choicesFromCall(0);
    const gatesRow = choices.find((c) => c.value === 'autopilot.gates')!;
    expect(gatesRow.disabled).toBeFalsy();
  });

  it('an env-overridden key (telemetry.enabled) is annotated in its row', async () => {
    process.env.RASEN_TELEMETRY = '0';
    const { select } = await getPromptMocks();
    select.mockResolvedValueOnce('__exit__');

    await runConfigCommand([]);

    const choices = await choicesFromCall(0);
    const telemetryRow = choices.find((c) => c.value === 'telemetry.enabled')!;
    expect(telemetryRow.name).toContain('env-override');
    expect(telemetryRow.name).toContain('environment variable takes precedence');
  });

  it('editing a single-scope project enum key (autopilot.gates) writes it and refreshes the view', async () => {
    const projectRoot = makeProject();
    const { select } = await getPromptMocks();
    select
      .mockResolvedValueOnce('autopilot.gates') // pick the key
      .mockResolvedValueOnce('off') // enum value prompt (no scope prompt: single-scope key)
      .mockResolvedValueOnce('__exit__'); // refreshed view, exit

    await runConfigCommand([]);

    expect(select).toHaveBeenCalledTimes(3);
    expect(consoleLogSpy).toHaveBeenCalledWith('Set autopilot.gates = "off"');
    const raw = fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8');
    expect(raw).toMatch(/gates: off/);

    // The enum choices offered were exactly the registry's enumValues.
    const enumChoices = (select.mock.calls[1][0] as { choices: { value: string }[] }).choices;
    expect(enumChoices.map((c) => c.value).sort()).toEqual(['off', 'on']);
  });

  it('editing a boolean key (proactive) prompts true/false and writes to global config', async () => {
    const { select } = await getPromptMocks();
    select
      .mockResolvedValueOnce('proactive')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce('__exit__');

    await runConfigCommand([]);

    expect(consoleLogSpy).toHaveBeenCalledWith('Set proactive = false');
    const { getGlobalConfig } = await import('../../src/core/global-config.js');
    expect(getGlobalConfig().proactive).toBe(false);

    const booleanChoices = (select.mock.calls[1][0] as { choices: { value: boolean }[] }).choices;
    expect(booleanChoices.map((c) => c.value)).toEqual([true, false]);
  });

  it('editing a both-scope key inside a project prompts for scope, then writes to the chosen scope via input()', async () => {
    makeProject();
    const { select, input } = await getPromptMocks();
    select
      .mockResolvedValueOnce('handoff.threshold') // pick the key
      .mockResolvedValueOnce('global') // scope prompt (both-scope key, inside a project)
      .mockResolvedValueOnce('__exit__'); // refreshed view, exit
    input.mockResolvedValueOnce('0.6');

    await runConfigCommand([]);

    expect(input).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).toHaveBeenCalledWith('Set handoff.threshold = 0.6');
    const { getGlobalConfig } = await import('../../src/core/global-config.js');
    expect(getGlobalConfig().handoff?.threshold).toBe(0.6);
  });

  it('editing a both-scope key writing to project scope preserves the file', async () => {
    const projectRoot = makeProject();
    const { select, input } = await getPromptMocks();
    select
      .mockResolvedValueOnce('handoff.threshold')
      .mockResolvedValueOnce('project')
      .mockResolvedValueOnce('__exit__');
    input.mockResolvedValueOnce('0.4');

    await runConfigCommand([]);

    const raw = fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8');
    expect(raw).toMatch(/threshold: 0\.4/);
  });

  it('does not prompt for scope for a both-scope key outside a project (falls back to global)', async () => {
    const { select, input } = await getPromptMocks();
    select
      .mockResolvedValueOnce('handoff.threshold')
      .mockResolvedValueOnce('__exit__');
    input.mockResolvedValueOnce('0.7');

    await runConfigCommand([]);

    // Only 2 select() calls (key pick + refresh) — no scope-select call.
    expect(select).toHaveBeenCalledTimes(2);
    const { getGlobalConfig } = await import('../../src/core/global-config.js');
    expect(getGlobalConfig().handoff?.threshold).toBe(0.7);
  });

  it('editing a threshold key with the absolute { remainingTokens } form via input() writes the object (MIN-M2)', async () => {
    const { select, input } = await getPromptMocks();
    select
      .mockResolvedValueOnce('handoff.threshold') // pick the key
      .mockResolvedValueOnce('__exit__'); // refreshed view, exit
    input.mockResolvedValueOnce('{"remainingTokens": 60000}');

    await runConfigCommand([]);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      'Set handoff.threshold = {"remainingTokens":60000}'
    );
    const { getGlobalConfig } = await import('../../src/core/global-config.js');
    expect(getGlobalConfig().handoff?.threshold).toEqual({ remainingTokens: 60000 });
  });

  it('the threshold input() validator accepts both dual forms and rejects an invalid absolute form (MIN-M2)', async () => {
    const { select, input } = await getPromptMocks();
    select
      .mockResolvedValueOnce('handoff.threshold')
      .mockResolvedValueOnce('__exit__');
    input.mockResolvedValueOnce('0.5');

    await runConfigCommand([]);

    const validate = (input.mock.calls[0][0] as { validate: (v: string) => string | true }).validate;
    expect(validate('0.5')).toBe(true);
    expect(validate('{"remainingTokens": 60000}')).toBe(true);
    expect(validate('{"remainingTokens": 0}')).toMatch(/positive integer/);
    expect(validate('1.5')).toMatch(/\(0, 1\]/);
  });

  it('the input() validator rejects an out-of-range value before it is accepted', async () => {
    const { select, input } = await getPromptMocks();
    select
      .mockResolvedValueOnce('handoff.threshold')
      .mockResolvedValueOnce('__exit__');
    input.mockResolvedValueOnce('0.5');

    await runConfigCommand([]);

    const validate = (input.mock.calls[0][0] as { validate: (v: string) => string | true }).validate;
    expect(validate('1.5')).toMatch(/\(0, 1\]/);
    expect(validate('0.5')).toBe(true);
  });

  it('Ctrl+C exits cleanly with code 130 and makes no partial write', async () => {
    const projectRoot = makeProject();
    const before = fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8');

    const { select } = await getPromptMocks();
    const cancellationError = new Error('User force closed the prompt with SIGINT');
    cancellationError.name = 'ExitPromptError';
    select.mockRejectedValueOnce(cancellationError);

    await expect(runConfigCommand([])).resolves.toBeUndefined();

    expect(process.exitCode).toBe(130);
    const after = fs.readFileSync(path.join(projectRoot, 'rasen', 'config.yaml'), 'utf-8');
    expect(after).toBe(before);
  });

  it('Ctrl+C during the value prompt also exits 130 without writing', async () => {
    makeProject();
    const { select, input } = await getPromptMocks();
    const cancellationError = new Error('User force closed the prompt with SIGINT');
    cancellationError.name = 'ExitPromptError';
    select.mockResolvedValueOnce('handoff.threshold').mockResolvedValueOnce('project');
    input.mockRejectedValueOnce(cancellationError);

    await expect(runConfigCommand([])).resolves.toBeUndefined();

    expect(process.exitCode).toBe(130);
    const { getGlobalConfig } = await import('../../src/core/global-config.js');
    expect(getGlobalConfig().handoff?.threshold).toBeUndefined();
  });
});
