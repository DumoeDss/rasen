/**
 * Explicit filesystem path-identity policy.
 *
 * Do not infer this from `node:path` namespace object identity: under ESM the
 * namespace wrapper is distinct from both `path.win32` and `path.posix`.
 */
export type PathIdentityFlavor = 'win32' | 'posix';

export const NATIVE_PATH_IDENTITY_FLAVOR: PathIdentityFlavor =
  process.platform === 'win32' ? 'win32' : 'posix';

export function foldPathIdentity(
  value: string,
  flavor: PathIdentityFlavor = NATIVE_PATH_IDENTITY_FLAVOR
): string {
  return flavor === 'win32' ? value.toLocaleLowerCase('en-US') : value;
}

export function pathIdentityEquals(
  left: string,
  right: string,
  flavor: PathIdentityFlavor = NATIVE_PATH_IDENTITY_FLAVOR
): boolean {
  return foldPathIdentity(left, flavor) === foldPathIdentity(right, flavor);
}
