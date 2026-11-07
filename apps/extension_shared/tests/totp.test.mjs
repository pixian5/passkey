import test from "node:test";
import assert from "node:assert/strict";
import {
  base32Decode,
  base32Encode,
  hotp,
  totpCode,
  formatOtpDisplay,
  normalizedTotpSecret,
  isValidTotpSecret,
  normalizeImportedSite,
  parseOtpAuthUri,
  readProtoVarint,
  googleMigrationEntries,
} from "../../codex-tauri/src/totp.js";

test("base32 encode and decode roundtrips correctly", () => {
  const original = new TextEncoder().encode("Hello, World! 12345");
  const encoded = base32Encode(original);
  assert.equal(typeof encoded, "string");
  const decoded = base32Decode(encoded);
  assert.deepEqual(decoded, original);
});

test("RFC 6238 standard test vectors with SHA-1", async () => {
  // RFC 6238 Appendix B test secret: "12345678901234567890" (20 bytes)
  // In Base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  // At 59s: counter = 1 -> "287082"
  const res59 = await totpCode(secret, 59 * 1000);
  assert.equal(res59.code, "287082");
  assert.equal(res59.remain, 1);

  // At 1111111109s: counter = 37037036 -> "081804"
  const res1 = await totpCode(secret, 1111111109 * 1000);
  assert.equal(res1.code, "081804");

  // At 1111111111s: counter = 37037037 -> "050471"
  const res2 = await totpCode(secret, 1111111111 * 1000);
  assert.equal(res2.code, "050471");

  // At 1234567890s: counter = 41152263 -> "005924"
  const res3 = await totpCode(secret, 1234567890 * 1000);
  assert.equal(res3.code, "005924");

  // At 2000000000s: counter = 66666666 -> "279037"
  const res4 = await totpCode(secret, 2000000000 * 1000);
  assert.equal(res4.code, "279037");
});

test("formatOtpDisplay handles spacing and fallback", () => {
  assert.equal(formatOtpDisplay("123456"), "123 456");
  assert.equal(formatOtpDisplay(""), "------");
  assert.equal(formatOtpDisplay(null), "------");
  assert.equal(formatOtpDisplay("12345"), "12345");
});

test("normalizedTotpSecret cleans whitespace, hyphens, and padding", () => {
  assert.equal(normalizedTotpSecret(" jb sw y3 dp eh pk 3p xp == "), "JBSWY3DPEHPK3PXP");
  assert.equal(normalizedTotpSecret("jb-sw-y3-dp"), "JBSWY3DP");
});

test("isValidTotpSecret validates character set and length", () => {
  assert.equal(isValidTotpSecret("JBSWY3DPEHPK3PXP"), true);
  assert.equal(isValidTotpSecret("JBSWY3D"), false); // too short (<8)
  assert.equal(isValidTotpSecret("JBSWY3D8"), false); // '8' is not in Base32 (A-Z, 2-7)
  assert.equal(isValidTotpSecret("JBSWY3D0"), false); // '0' is not in Base32
});

test("normalizeImportedSite extracts domain name cleanly", () => {
  assert.equal(normalizeImportedSite("https://github.com/login"), "github.com");
  assert.equal(normalizeImportedSite("http://vault.example.com:8080/path"), "vault.example.com");
  assert.equal(normalizeImportedSite("google"), "google.com");
  assert.equal(normalizeImportedSite(""), "");
});

test("parseOtpAuthUri extracts secret, username, and site", () => {
  const uri = "otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXP&issuer=GitHub";
  const parsed = parseOtpAuthUri(uri);
  assert.notEqual(parsed, null);
  assert.equal(parsed.secret, "JBSWY3DPEHPK3PXP");
  assert.equal(parsed.username, "alice");
  assert.equal(parsed.site, "github.com");

  // Invalid scheme or host
  assert.equal(parseOtpAuthUri("https://example.com"), null);
  assert.equal(parseOtpAuthUri("otpauth://hotp/foo?secret=JBSWY3DPEHPK3PXP"), null);
  // Invalid secret
  assert.equal(parseOtpAuthUri("otpauth://totp/foo?secret=SHORT"), null);
});

test("googleMigrationEntries decodes migration URI protobuf data", () => {
  // Construct a minimal valid otpauth-migration payload:
  // Tag 1 (length-delimited):
  //   tag 1 (secret bytes): "1234567890" (10 bytes)
  //   tag 2 (name): "test@example.com"
  //   tag 3 (issuer): "ExampleCorp"
  //   tag 6 (type): 2 (TOTP)
  const secretBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const nameBytes = new TextEncoder().encode("alice@example.com");
  const issuerBytes = new TextEncoder().encode("ExampleService");

  const innerBytes = [];
  // tag 1 (field 1, wire 2) -> (1 << 3) | 2 = 10
  innerBytes.push(10, secretBytes.length, ...secretBytes);
  // tag 2 (field 2, wire 2) -> (2 << 3) | 2 = 18
  innerBytes.push(18, nameBytes.length, ...nameBytes);
  // tag 3 (field 3, wire 2) -> (3 << 3) | 2 = 26
  innerBytes.push(26, issuerBytes.length, ...issuerBytes);
  // tag 6 (field 6, wire 0) -> (6 << 3) | 0 = 48, value = 2 (TOTP)
  innerBytes.push(48, 2);

  const outerBytes = [];
  // tag 1 (field 1, wire 2) -> 10, length, innerBytes
  outerBytes.push(10, innerBytes.length, ...innerBytes);

  const b64 = Buffer.from(outerBytes).toString("base64");
  const migrationUrl = `otpauth-migration://offline?data=${encodeURIComponent(b64)}`;

  const entries = googleMigrationEntries(migrationUrl);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].username, "alice@example.com");
  assert.equal(entries[0].site, "exampleservice.com");
  assert.equal(entries[0].secret, base32Encode(secretBytes));
});
