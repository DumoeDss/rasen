import * as fs from 'node:fs';

/**
 * Lets Node's built-in TypeScript transform execute the source-backed browser
 * fixture without adding a repository dependency. Production imports spell
 * `.js`; in the source tree their checked-in implementation is `.ts`.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error?.code !== 'ERR_MODULE_NOT_FOUND' ||
      !specifier.endsWith('.js') ||
      (!specifier.startsWith('.') && !specifier.startsWith('file:'))
    ) {
      throw error;
    }
    const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
    if (!fs.existsSync(candidate)) throw error;
    return nextResolve(candidate.href, context);
  }
}
