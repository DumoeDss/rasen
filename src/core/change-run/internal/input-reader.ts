import { lstatSync, readFileSync } from 'node:fs';

export type InputReaderErrorCode =
  | 'input_too_large'
  | 'input_not_regular'
  | 'input_malformed'
  | 'input_not_found';

export class InputReaderError extends Error {
  constructor(
    readonly code: InputReaderErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'InputReaderError';
  }
}

/**
 * Bounded no-follow input reader (task 12.6). Reads a file for completion/
 * control payloads: rejects symlinks, non-regular files, oversized bodies, and
 * malformed JSON with stable non-zero typed errors. Never follows links.
 */
export function readBoundedJson(path: string, maxBytes = 1024 * 1024): unknown {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    throw new InputReaderError('input_not_found', `Input file not found: ${path}`);
  }
  if (!st.isFile()) {
    throw new InputReaderError('input_not_regular', `Input is not a regular file: ${path}`);
  }
  if (st.size > maxBytes) {
    throw new InputReaderError('input_too_large', `Input exceeds ${maxBytes} bytes.`);
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new InputReaderError('input_not_found', `Could not read input: ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new InputReaderError('input_malformed', 'Input is not valid JSON.');
  }
}
