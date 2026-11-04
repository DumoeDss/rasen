//! Renderings the TypeScript provider binds to, and a dependency-free JSON writer.
//!
//! The provider's reference codec projects the attestation **field by field by name**, so the
//! key names and the value renderings here are the actual contract — not a presentation
//! choice. A `scope_id` key reads as `undefined` on that side and fails as malformed.
//!
//! `base64url` is unpadded (RFC 4648 §5), which is what the provider's
//! `/^[A-Za-z0-9_-]{22}$/` and `{43}` validators expect for 16- and 32-byte values.

use std::fmt::Write as _;

const BASE64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Unpadded base64url. 16 bytes render to 22 characters, 32 bytes to 43.
pub fn base64url(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let block = match chunk.len() {
            3 => (u32::from(chunk[0]) << 16) | (u32::from(chunk[1]) << 8) | u32::from(chunk[2]),
            2 => (u32::from(chunk[0]) << 16) | (u32::from(chunk[1]) << 8),
            _ => u32::from(chunk[0]) << 16,
        };
        let characters = chunk.len() + 1;
        for index in 0..characters {
            let shift = 18 - index * 6;
            output.push(BASE64URL[((block >> shift) & 0x3f) as usize] as char);
        }
    }
    output
}

/// Decode unpadded base64url. Rejects padding, whitespace and any character outside the
/// alphabet rather than skipping it.
pub fn from_base64url(value: &str) -> Option<Vec<u8>> {
    if value.is_empty() || value.len() % 4 == 1 {
        return None;
    }
    let mut output = Vec::with_capacity(value.len() / 4 * 3);
    let mut accumulator = 0_u32;
    let mut bits = 0_u32;
    for character in value.bytes() {
        let index = BASE64URL.iter().position(|candidate| *candidate == character)? as u32;
        accumulator = (accumulator << 6) | index;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((accumulator >> bits) & 0xff) as u8);
        }
    }
    // Any leftover bits must be zero, otherwise the encoding carried data it cannot represent.
    if accumulator & ((1 << bits) - 1) != 0 {
        return None;
    }
    Some(output)
}

/// Render 16 bytes in canonical lowercase GUID form. The first three groups are big-endian in
/// our storage, which is how [`crate::boot`] writes them.
pub fn guid_text(bytes: &[u8; 16]) -> String {
    let mut output = String::with_capacity(36);
    for (index, byte) in bytes.iter().enumerate() {
        if matches!(index, 4 | 6 | 8 | 10) {
            output.push('-');
        }
        let _ = write!(output, "{byte:02x}");
    }
    output
}

/// A minimal JSON object writer. Values are emitted in insertion order; keys are written
/// verbatim and must be ASCII identifiers.
#[derive(Default)]
pub struct JsonObject {
    body: String,
}

impl JsonObject {
    pub fn new() -> Self {
        Self {
            body: String::new(),
        }
    }

    fn separate(&mut self) {
        if !self.body.is_empty() {
            self.body.push(',');
        }
    }

    pub fn string(&mut self, key: &str, value: &str) -> &mut Self {
        self.separate();
        let _ = write!(self.body, "\"{key}\":");
        escape_into(&mut self.body, value);
        self
    }

    pub fn number(&mut self, key: &str, value: u64) -> &mut Self {
        self.separate();
        let _ = write!(self.body, "\"{key}\":{value}");
        self
    }

    pub fn boolean(&mut self, key: &str, value: bool) -> &mut Self {
        self.separate();
        let _ = write!(self.body, "\"{key}\":{value}");
        self
    }

    /// Omit a key entirely rather than writing an empty string. An absent field reads as
    /// `undefined` on the provider side and fails closed; an empty string would look like a
    /// value that was supplied and happened to be blank.
    pub fn optional_string(&mut self, key: &str, value: Option<&str>) -> &mut Self {
        match value {
            Some(value) if !value.is_empty() => self.string(key, value),
            _ => self,
        }
    }

    pub fn finish(&self) -> String {
        format!("{{{}}}", self.body)
    }
}

fn escape_into(output: &mut String, value: &str) {
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            character if (character as u32) < 0x20 => {
                let _ = write!(output, "\\u{:04x}", character as u32);
            }
            character => output.push(character),
        }
    }
    output.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_matches_the_rfc_4648_alphabet_and_is_unpadded() {
        assert_eq!(base64url(b""), "");
        assert_eq!(base64url(b"f"), "Zg");
        assert_eq!(base64url(b"fo"), "Zm8");
        assert_eq!(base64url(b"foo"), "Zm9v");
        assert_eq!(base64url(b"foob"), "Zm9vYg");
        assert_eq!(base64url(b"fooba"), "Zm9vYmE");
        assert_eq!(base64url(b"foobar"), "Zm9vYmFy");
        // The two characters that distinguish base64url from base64.
        assert_eq!(base64url(&[0xfb, 0xff, 0xfe]), "-__-");
        assert!(!base64url(&[0xff; 32]).contains('='));
    }

    #[test]
    fn the_provider_width_expectations_hold_for_sixteen_and_thirty_two_bytes() {
        // The provider validates /^[A-Za-z0-9_-]{22}$/ for 16-byte values and {43} for 32-byte
        // values. These are the exact widths, asserted rather than assumed.
        assert_eq!(base64url(&[0_u8; 16]).len(), 22);
        assert_eq!(base64url(&[0xff_u8; 16]).len(), 22);
        assert_eq!(base64url(&[0_u8; 32]).len(), 43);
        assert_eq!(base64url(&[0xff_u8; 32]).len(), 43);
        for rendered in [base64url(&[0x5a_u8; 16]), base64url(&[0x5a_u8; 32])] {
            assert!(rendered
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'));
        }
    }

    #[test]
    fn base64url_round_trips_and_rejects_malformed_input() {
        for length in [1_usize, 2, 3, 15, 16, 31, 32, 64] {
            let bytes: Vec<u8> = (0..length).map(|index| (index * 7 % 251) as u8).collect();
            assert_eq!(
                from_base64url(&base64url(&bytes)).as_deref(),
                Some(bytes.as_slice()),
                "length {length}"
            );
        }
        assert!(from_base64url("Zm9vYmFy=").is_none(), "padding accepted");
        assert!(from_base64url("Zm9v YmFy").is_none(), "whitespace accepted");
        assert!(from_base64url("Zm9vYmF+").is_none(), "base64 alphabet accepted");
        assert!(from_base64url("Z").is_none(), "orphan character accepted");
        assert!(from_base64url("").is_none());
    }

    #[test]
    fn guid_text_is_lowercase_canonical_and_non_zero_values_render_non_zero() {
        let bytes: [u8; 16] = [
            0x58, 0xee, 0x57, 0x46, 0xc8, 0xd2, 0x11, 0xf0, 0xa2, 0x6f, 0xe4, 0x66, 0x7c, 0x1c,
            0x53, 0x58,
        ];
        let text = guid_text(&bytes);
        assert_eq!(text, "58ee5746-c8d2-11f0-a26f-e4667c1c5358");
        assert_eq!(text.len(), 36);
        assert_eq!(text, text.to_lowercase());
        assert_eq!(
            guid_text(&[0_u8; 16]),
            "00000000-0000-0000-0000-000000000000"
        );
    }

    #[test]
    fn json_writes_keys_in_insertion_order_and_escapes_values() {
        let mut object = JsonObject::new();
        object
            .string("scopeId", "AAAA")
            .number("guardianProcessId", 42)
            .boolean("workloadProcessExists", false);
        assert_eq!(
            object.finish(),
            "{\"scopeId\":\"AAAA\",\"guardianProcessId\":42,\"workloadProcessExists\":false}"
        );

        let mut escaped = JsonObject::new();
        escaped.string("k", "a\"b\\c\nd\te");
        assert_eq!(escaped.finish(), "{\"k\":\"a\\\"b\\\\c\\nd\\te\"}");

        let mut control = JsonObject::new();
        control.string("k", "a\u{1}b");
        assert_eq!(control.finish(), "{\"k\":\"a\\u0001b\"}");
    }

    #[test]
    fn an_absent_optional_is_omitted_rather_than_emitted_empty() {
        // The provider reads absent as `undefined` and fails closed. An empty string would look
        // like a supplied value that happened to be blank, which is exactly the confusion an
        // unbound build receipt must not create.
        let mut object = JsonObject::new();
        object
            .string("a", "1")
            .optional_string("sourceSha256", None)
            .optional_string("artifactSha256", Some(""))
            .optional_string("present", Some("x"));
        assert_eq!(object.finish(), "{\"a\":\"1\",\"present\":\"x\"}");
        assert!(!object.finish().contains("sourceSha256"));
        assert!(!object.finish().contains("artifactSha256"));
    }
}
