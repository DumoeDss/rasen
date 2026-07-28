/**
 * Fail-soft error taxonomy for the token-audit module (design D3).
 *
 * `TranscriptFormatError` is the ONLY error type the CLI layer treats as a
 * friendly, non-crashing failure — thrown by the parse layer (parse.ts,
 * parse-codex.ts) whenever an assumption about the transcript/rollout shape
 * breaks in a way that would corrupt the dedup/TTL/delta math. A plain
 * unparseable JSON line is NOT this — that keeps being skipped, matching
 * `audit.mjs`'s existing behavior (unchanged for both runtimes).
 */
export class TranscriptFormatError extends Error {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly detail: string;

  constructor(message: string, filePath: string, lineNumber: number, detail: string) {
    super(message);
    this.name = 'TranscriptFormatError';
    this.filePath = filePath;
    this.lineNumber = lineNumber;
    this.detail = detail;
  }
}
