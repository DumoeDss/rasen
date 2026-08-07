import type { ProcessScope } from '../process-scope.js';
import { createDarwinBestEffortProcessScope } from './darwin-best-effort-scope.js';
import { createNativeProcessScope, type NativeProcessScopeOptions } from './native-process-scope.js';

export interface HostedProcessScopeOptions extends NativeProcessScopeOptions {
  /** Test seam only; production construction reads process.platform. */
  platform?: NodeJS.Platform;
}

/**
 * Hosted-session ProcessScope construction.
 *
 * darwin selects the declared best-effort tier; every other platform keeps the
 * exact-tier native capsule unchanged. Host-native (Tier A) dispatch never
 * enters ProcessScope and is untouched by this selection.
 */
export function createHostedProcessScope(
  options: HostedProcessScopeOptions = {}
): ProcessScope {
  const { platform = process.platform, ...nativeOptions } = options;
  if (platform === 'darwin') return createDarwinBestEffortProcessScope();
  return createNativeProcessScope(nativeOptions);
}
