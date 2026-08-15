/**
 * Reject recognizable double-decoding signatures without banning legitimate
 * letters such as Portuguese `Ã` or French `â`. These signatures are evidence
 * of UTF-8 bytes decoded as a single-byte encoding and then persisted again.
 */
export function hasTypicalMojibake(text: string): boolean {
  return (
    /(?:Ã|Â)[\u0080-\u00bf]/u.test(text) ||
    /â(?:€.|[\u0080-\u00bf]{2})/u.test(text) ||
    /(?:鍙戝|鏂囦|锛[屽]|銆[傘]|浣犲ソ)/u.test(text)
  );
}
