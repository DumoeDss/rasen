// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  extractTokenFromHash,
  initTokenFromLocation,
  getToken,
  hasToken,
  isUnauthorized,
  markUnauthorized,
  resetTokenStateForTest,
} from '../../src/api/token.js';

describe('extractTokenFromHash', () => {
  it('extracts a token from a simple fragment', () => {
    expect(extractTokenFromHash('#token=abc123')).toBe('abc123');
  });

  it('decodes percent-encoded characters', () => {
    expect(extractTokenFromHash('#token=ab%2Bc')).toBe('ab+c');
  });

  it('returns null when no token is present', () => {
    expect(extractTokenFromHash('')).toBeNull();
    expect(extractTokenFromHash('#other=1')).toBeNull();
  });
});

describe('initTokenFromLocation', () => {
  beforeEach(() => {
    resetTokenStateForTest();
    window.history.replaceState(null, '', '/');
  });

  it('reads the token from the hash into memory and scrubs the address bar', () => {
    window.history.replaceState(null, '', '/#token=deadbeef');
    initTokenFromLocation();
    expect(getToken()).toBe('deadbeef');
    expect(hasToken()).toBe(true);
    expect(location.hash).toBe('');
    expect(location.pathname).toBe('/');
  });

  it('preserves the path and query when scrubbing', () => {
    window.history.replaceState(null, '', '/config?foo=bar#token=xyz');
    initTokenFromLocation();
    expect(location.pathname).toBe('/config');
    expect(location.search).toBe('?foo=bar');
    expect(location.hash).toBe('');
  });

  it('leaves the token unset when the fragment has no token', () => {
    window.history.replaceState(null, '', '/');
    initTokenFromLocation();
    expect(getToken()).toBeNull();
    expect(hasToken()).toBe(false);
  });
});

describe('unauthorized state', () => {
  beforeEach(() => resetTokenStateForTest());

  it('starts false and flips once marked', () => {
    expect(isUnauthorized()).toBe(false);
    markUnauthorized();
    expect(isUnauthorized()).toBe(true);
  });
});
