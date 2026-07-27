/**
 * M9 credential-parser regression tests. The parser lives in
 * `src/core/store/remote.ts` (`remoteCarriesCredentials` +
 * `assertCredentialFreeRemote`); it gates every clone path through
 * `cloneWithCleanupGuard`. These tests pin the intended behavior of the URL
 * parser so a future change to `remoteCarriesCredentials` cannot silently
 * start accepting credential-bearing remotes (false negative) or rejecting
 * legitimate credential-free forms (false positive).
 *
 * The `?token=abc` case in particular is a known false-positive trap: a
 * query-string parameter named `token` is NOT URL userinfo, so the URL
 * carries no embedded credential and must NOT be rejected. tasks.md item 1.4
 * asked for this regression-protection test.
 */
import { describe, expect, it } from 'vitest';

import {
  assertCredentialFreeRemote,
  redactRemote,
  remoteCarriesCredentials,
} from '../../../src/core/store/remote.js';
import { StoreError } from '../../../src/core/store/errors.js';

describe('M9 credential parser — remoteCarriesCredentials', () => {
  describe('detects embedded credentials (true)', () => {
    it.each([
      ['https with user:password userinfo', 'https://user:secret@host.example.com/repo.git'],
      ['https with token-only userinfo', 'https://token@host.example.com/repo.git'],
      ['git+https with token userinfo', 'git+https://token@host.example.com/repo.git'],
      ['https with password only (empty user)', 'https://:pass@host.example.com/repo.git'],
    ])('detects %s', (_label, remote) => {
      expect(remoteCarriesCredentials(remote)).toBe(true);
    });
  });

  describe('passes credential-free remotes (false)', () => {
    it.each([
      ['plain https with no userinfo', 'https://host.example.com/repo.git'],
      ['https with trailing slash', 'https://host.example.com/repo.git/'],
      ['ssh://git@host (account name, not a secret)', 'ssh://git@host.example.com/repo.git'],
      ['git+ssh://git@host', 'git+ssh://git@host.example.com/repo.git'],
      ['git://git@host', 'git://git@host.example.com/repo.git'],
      ['scp-style SSH (not a URL — parser passes it through)', 'git@github.com:org/repo.git'],
      ['local file path', '/srv/repos/team.git'],
      ['file:// URL with no userinfo', 'file:///srv/repos/team.git'],
    ])('passes %s', (_label, remote) => {
      expect(remoteCarriesCredentials(remote)).toBe(false);
    });
  });

  describe('?token=abc query-string is NOT a credential (tasks.md 1.4 regression)', () => {
    // A `?token=...` query parameter is NOT URL userinfo. new URL(...) parses
    // it into url.search, leaving url.username and url.password empty, so the
    // parser MUST return false. A future change that, e.g., regex-scans for
    // "token" substrings would falsely reject this remote and break legitimate
    // deployments that pass deploy tokens as query parameters.
    it.each([
      ['https with ?token=abc query', 'https://host.example.com/repo.git?token=abc'],
      ['https with ?token= and nothing else', 'https://host.example.com/repo.git?token='],
      ['https with ?access_token= query', 'https://host.example.com/repo.git?access_token=xyz'],
      ['https with userinfo-absent and ?token= plus path', 'https://host.example.com/sub/repo.git?token=abc&other=1'],
    ])('does NOT reject %s', (_label, remote) => {
      expect(remoteCarriesCredentials(remote)).toBe(false);
      // The guard also must not throw — the remote is credential-free.
      expect(() => assertCredentialFreeRemote(remote, 'store.pointer')).not.toThrow();
    });

    it('a query-string token does NOT change the redacted form (redactRemote is a no-op)', () => {
      const remote = 'https://host.example.com/repo.git?token=abc';
      // No credentials → redactRemote returns the input unchanged. The query
      // string survives because the parser never classified it as a secret.
      expect(redactRemote(remote)).toBe(remote);
    });

    it('contrast: a real userinfo token IS rejected and redacted (parser sanity)', () => {
      // Same host and token, but now in userinfo position. The parser MUST
      // catch this. This is the contrast case that makes the query-string
      // test meaningful: the parser's discrimination is positional, not
      // substring-based.
      const remote = 'https://abc@host.example.com/repo.git';
      expect(remoteCarriesCredentials(remote)).toBe(true);
      expect(redactRemote(remote)).toBe('https://<redacted>@host.example.com/repo.git');
      expect(() => assertCredentialFreeRemote(remote, 'store.pointer')).toThrow(StoreError);
    });
  });
});
