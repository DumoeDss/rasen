import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from 'node:fs';

import {
  assertSafeRunPath,
  createNodeSafePathPlumbing,
} from './safe-path.js';

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
function parseJsonBytes(path: string, maxBytes: number): unknown {
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
  let descriptor: number | undefined;
  let text: string;
  try {
    const noFollow = 'O_NOFOLLOW' in constants
      ? (constants as typeof constants & { O_NOFOLLOW: number }).O_NOFOLLOW
      : 0;
    descriptor = openSync(path, constants.O_RDONLY | noFollow);
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.size !== st.size ||
      opened.dev !== st.dev ||
      opened.ino !== st.ino
    ) {
      throw new InputReaderError(
        'input_not_regular',
        `Input identity changed before it could be read: ${path}`
      );
    }
    if (opened.size > maxBytes) {
      throw new InputReaderError('input_too_large', `Input exceeds ${maxBytes} bytes.`);
    }
    const bounded = Buffer.allocUnsafe(maxBytes + 1);
    let bytesRead = 0;
    while (bytesRead <= maxBytes) {
      const count = readSync(
        descriptor,
        bounded,
        bytesRead,
        maxBytes + 1 - bytesRead,
        null
      );
      if (count === 0) break;
      bytesRead += count;
    }
    if (bytesRead > maxBytes) {
      throw new InputReaderError('input_too_large', `Input exceeds ${maxBytes} bytes.`);
    }
    const afterRead = fstatSync(descriptor);
    if (
      afterRead.dev !== opened.dev ||
      afterRead.ino !== opened.ino ||
      afterRead.size !== bytesRead
    ) {
      throw new InputReaderError(
        'input_not_regular',
        `Input identity changed while it was read: ${path}`
      );
    }
    text = bounded.subarray(0, bytesRead).toString('utf8');
  } catch (error) {
    if (error instanceof InputReaderError) throw error;
    throw new InputReaderError('input_not_found', `Could not read input: ${path}`);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new InputReaderError('input_malformed', 'Input is not valid JSON.');
  }
}

export function readBoundedJson(path: string, maxBytes = 1024 * 1024): unknown {
  return parseJsonBytes(path, maxBytes);
}

/**
 * Read a bounded JSON bridge only after physical SafeRunPath authorization.
 * The path is checked both before and after the descriptor-backed read. This
 * rejects link/junction traversal and observable parent replacement. Pure
 * Node cannot make an arbitrary multi-component parent walk atomic on every
 * supported platform; callers therefore keep the bridge under a private
 * ephemera root and this function fails closed on every detectable change.
 */
export function readBoundedJsonWithinRoot(
  root: string,
  path: string,
  maxBytes = 1024 * 1024
): unknown {
  const plumbing = createNodeSafePathPlumbing();
  assertSafeRunPath(root, path, plumbing);
  const decoded = parseJsonBytes(path, maxBytes);
  assertSafeRunPath(root, path, plumbing);
  return decoded;
}
