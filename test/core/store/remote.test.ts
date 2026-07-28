/**
 * M9 credential-parser regression tests. The parser lives in
 * `src/core/store/remote.ts` (`remoteCarriesCredentials` +
 * `assertCredentialFreeRemote` + `redactRemote`); it gates every clone path
 * through `cloneWithCleanupGuard`. These tests pin the intended behavior of
 * the URL parser so a future change to `remoteCarriesCredentials` cannot
 * silently start accepting credential-bearing remotes (false negative) or
 * rejecting legitimate credential-free forms (false positive).
 *
 * Credentials are detected in three positions: userinfo (password or
 * token-shaped username), query string, and fragment. Git clone URLs never
 * legitimately carry query strings or fragments, so any non-empty search/hash
 * is treated as credential-bearing (default-deny, B4).
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

  describe('query-string and fragment credentials ARE detected (B4 regression)', () => {
    // Git clone URLs never legitimately carry query strings or fragments. The
    // only real-world query-bearing git URLs are deploy tokens, signed URLs,
    // and cloud-provider auth — all credentials. Default-deny on any non-empty
    // search/hash cannot be bypassed by renaming a parameter.
    it.each([
      ['?token=abc query', 'https://host.example.com/repo.git?token=abc', 'abc'],
      ['?access_token=xyz query', 'https://host.example.com/repo.git?access_token=xyz', 'xyz'],
      ['?private_token= query', 'https://host.example.com/repo.git?private_token=', 'private_token'],
      ['signed-URL ?Signature=&Expires=', 'https://storage.example.com/repo.git?Signature=abc123&Expires=9999999999', 'abc123'],
      ['#token=secret fragment', 'https://host.example.com/repo.git#token=secret', 'secret'],
      ['?token= with path prefix and extra params', 'https://host.example.com/sub/repo.git?token=abc&other=1', 'abc'],
    ])('rejects %s', (_label, remote, secret) => {
      expect(remoteCarriesCredentials(remote)).toBe(true);
      expect(() => assertCredentialFreeRemote(remote, 'store.pointer')).toThrow(StoreError);
      expect(redactRemote(remote)).not.toContain(secret);
    });

    it('redactRemote drops the query and shows ?<redacted> (no secret echo)', () => {
      const remote = 'https://host.example.com/repo.git?access_token=secret';
      expect(redactRemote(remote)).toBe('https://host.example.com/repo.git?<redacted>');
      expect(redactRemote(remote)).not.toContain('secret');
      expect(redactRemote(remote)).not.toContain('access_token');
    });

    it('redactRemote redacts both userinfo and query when both carry secrets', () => {
      const remote = 'https://token@host.example.com/repo.git?private_token=xyz';
      expect(redactRemote(remote)).toBe('https://<redacted>@host.example.com/repo.git?<redacted>');
      expect(redactRemote(remote)).not.toContain('xyz');
      expect(redactRemote(remote)).not.toContain('private_token');
    });

    it('contrast: a real userinfo token IS rejected and redacted (parser sanity)', () => {
      // Same host and token, but now in userinfo position. The parser MUST
      // catch this. This is the contrast case that confirms the parser's
      // discrimination is positional, not substring-based.
      const remote = 'https://abc@host.example.com/repo.git';
      expect(remoteCarriesCredentials(remote)).toBe(true);
      expect(redactRemote(remote)).toBe('https://<redacted>@host.example.com/repo.git');
      expect(() => assertCredentialFreeRemote(remote, 'store.pointer')).toThrow(StoreError);
    });
  });
});
