import canonicalize from 'canonicalize';

/** RFC 8785 canonical JSON shared by package and portable identity contracts. */
export function canonicalJson(value: unknown): string {
  const result = canonicalize(value);
  if (result === undefined) {
    throw new TypeError('Value cannot be represented as canonical JSON');
  }
  return result;
}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), 'utf8');
}
