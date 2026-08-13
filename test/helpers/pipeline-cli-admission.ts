import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runCLI, type RunCliOptions } from './run-cli.js';

interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

interface Candidate {
  readonly candidateId: string;
  readonly runId: string;
  readonly recordVersion: number;
  readonly nodeId: string;
  readonly occurrence: number;
  readonly profilePath?: string;
  readonly input?: unknown;
}

function trustedPrompt(candidate: Candidate): string {
  return [
    'rasen trusted fresh-process test driver turn input',
    `candidate=${candidate.candidateId}`,
    `run=${candidate.runId}`,
    `recordVersion=${candidate.recordVersion}`,
    `node=${candidate.nodeId}`,
    `occurrence=${candidate.occurrence}`,
    `profile=${candidate.profilePath ?? ''}`,
    `input=${JSON.stringify(candidate.input ?? null)}`,
  ].join('\n');
}

/** Run a public pipeline command, then explicitly admit its exact preview. */
export async function runPipelineCLIWithAdmission(
  args: readonly string[],
  options: RunCliOptions
): Promise<CliResult> {
  const preview = await runCLI([...args], options);
  if (preview.exitCode !== 0 || preview.stdout.trim().length === 0) return preview;

  const decoded = JSON.parse(preview.stdout.trim()) as {
    runId?: string;
    candidates?: Candidate[];
  };
  const candidates = decoded.candidates ?? [];
  if (candidates.length === 0) return preview;
  if (decoded.runId === undefined) throw new Error('candidate preview omitted runId');

  const changeId = args[2];
  if (args[0] !== 'pipeline' || typeof changeId !== 'string') {
    throw new Error('pipeline admission helper requires a pipeline command with changeId');
  }
  const ephemera = path.join(
    options.cwd ?? process.cwd(),
    '.rasen',
    'changes',
    changeId,
    'ephemera'
  );
  mkdirSync(ephemera, { recursive: true });
  const manifestPath = path.join(
    ephemera,
    `turn-input-${decoded.runId.replace(/[^a-z0-9]/gi, '_')}-${candidates[0]!.recordVersion}.json`
  );
  writeFileSync(
    manifestPath,
    JSON.stringify({
      format: 'agent-turn-input-manifest/1',
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        prompt: trustedPrompt(candidate),
      })),
    }),
    'utf8'
  );

  const admitted = await runCLI(
    [
      'pipeline',
      'admit',
      changeId,
      '--run',
      decoded.runId,
      '--turn-input-file',
      manifestPath,
      '--json',
    ],
    options
  );
  if (admitted.exitCode !== 0) return admitted;
  const admittedJson = JSON.parse(admitted.stdout.trim()) as Record<string, unknown>;
  return {
    ...admitted,
    stdout: `${JSON.stringify({
      ...decoded,
      ...admittedJson,
      disposition: (decoded as { disposition?: unknown }).disposition,
    })}\n`,
  };
}
