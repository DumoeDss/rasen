/**
 * Store remote hygiene (design D9): credential detection by URL parsing and
 * the one redaction renderer every human and JSON surface uses.
 *
 * No regex scan for token-shaped substrings — that produces false positives on
 * legitimate paths and false confidence on unknown formats. The rule targets
 * embedded secrets, so an unparseable value (notably the scp-style
 * `git@github.com:org/repo.git` SSH form, which is not a URL at all) is passed
 * through unchanged rather than guessed at.
 */
import { StoreError } from './errors.js';

/**
 * Schemes whose userinfo is an account name, not a secret. `ssh://git@host/…`
 * is the ordinary SSH form and must keep working; `https://<token>@host/…` is
 * the classic embedded-credential form and must not.
 */
const SSH_LIKE_PROTOCOLS = new Set(['ssh:', 'git+ssh:', 'git:']);

function parseRemoteUrl(remote: string): URL | null {
  try {
    return new URL(remote);
  } catch {
    return null;
  }
}

/** True when the remote embeds a secret in userinfo, query string, or fragment. */
export function remoteCarriesCredentials(remote: string): boolean {
  const url = parseRemoteUrl(remote);
  if (!url) return false;
  if (url.password.length > 0) return true;
  if (url.username.length > 0 && !SSH_LIKE_PROTOCOLS.has(url.protocol)) return true;
  // Git clone URLs never legitimately carry query strings or fragments — the
  // only real-world uses are deploy tokens, signed URLs, and cloud-provider
  // auth parameters. Default-deny: any non-empty search/hash is credential-bearing.
  if (url.search !== '' || url.hash !== '') return true;
  return false;
}

/**
 * Renders a credential-bearing remote with every secret position replaced by a
 * redaction marker. `<redacted>@` covers userinfo secrets; `?<redacted>` covers
 * query/fragment secrets. A credential-free value is returned verbatim so an
 * ordinary SSH or HTTPS remote renders unchanged.
 */
export function redactRemote(remote: string): string {
  if (!remoteCarriesCredentials(remote)) return remote;
  const url = parseRemoteUrl(remote);
  if (!url) return remote;
  const hasUserinfoSecret =
    url.password.length > 0 ||
    (url.username.length > 0 && !SSH_LIKE_PROTOCOLS.has(url.protocol));
  const hasSearchOrHash = url.search !== '' || url.hash !== '';
  const auth = hasUserinfoSecret ? '<redacted>@' : '';
  const query = hasSearchOrHash ? '?<redacted>' : '';
  return `${url.protocol}//${auth}${url.host}${url.pathname}${query}`;
}

/** Optional-friendly wrapper, for the many places a remote may be absent. */
export function redactOptionalRemote(remote: string | undefined | null): string | undefined {
  if (remote === undefined || remote === null) return undefined;
  return redactRemote(remote);
}

/**
 * Write-path guard: a credential-bearing remote is rejected before anything is
 * written, and the rejected value is never echoed back in full.
 */
export function assertCredentialFreeRemote(
  remote: string | undefined,
  target: 'store.metadata' | 'store.pointer' = 'store.metadata'
): void {
  if (remote === undefined) return;
  if (!remoteCarriesCredentials(remote)) return;

  throw new StoreError(
    `The remote ${redactRemote(remote)} embeds a credential; Store metadata never carries credentials.`,
    'store_remote_credentials',
    {
      target,
      fix: 'Pass a credential-free remote (for example the https or ssh URL without userinfo) and keep the credential in your Git credential helper.',
    }
  );
}
