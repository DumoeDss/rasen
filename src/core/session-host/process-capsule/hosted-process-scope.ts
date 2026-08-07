import type { ProcessScope } from '../process-scope.js';
import { createNativeProcessScope, type NativeProcessScopeOptions } from './native-process-scope.js';
import { createPosixBestEffortProcessScope } from './posix-best-effort-scope.js';
import { createWin32BestEffortProcessScope } from './win32-best-effort-scope.js';

export interface HostedProcessScopeOptions extends NativeProcessScopeOptions {
  /** Test seam only; production construction reads process.platform. */
  platform?: NodeJS.Platform;
}

/**
 * Hosted-session ProcessScope construction.
 *
 * darwin and linux select the shared POSIX best-effort tier; win32 selects the
 * win32 best-effort tier, which keeps the legacy capsule's Job termination
 * mechanics under an honest declaration. Every other platform keeps the
 * exact-tier native capsule unchanged - this Direction makes no support claim
 * about them, and widening the cutover silently would be such a claim.
 * Host-native (Tier A) dispatch never enters ProcessScope and is untouched by
 * this selection.
 */
export function createHostedProcessScope(
  options: HostedProcessScopeOptions = {}
): ProcessScope {
  const { platform = process.platform, ...nativeOptions } = options;
  if (platform === 'darwin' || platform === 'linux') {
    return createPosixBestEffortProcessScope();
  }
  if (platform === 'win32') return createWin32BestEffortProcessScope(nativeOptions);
  return createNativeProcessScope(nativeOptions);
}
