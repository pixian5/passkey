import assert from "node:assert/strict";
import test from "node:test";
import {
  accountsToBrowserCsv,
  browserCsvToAccountDrafts,
  buildCsv,
  decodeSites,
  encodeSites,
  escapeCsvCell,
  parseCsv,
} from "../../../core/pass_core/js/csv_core.js";

test("escapeCsvCell 对齐 Rust 公式防护与引号转义", () => {
  assert.equal(escapeCsvCell("plain"), '"plain"');
  assert.equal(escapeCsvCell("=1+1"), '"\'=1+1"');
  assert.equal(escapeCsvCell('a"b'), '"a""b"');
  assert.equal(escapeCsvCell("a\nb"), '"a b"');
});

test("buildCsv 表头保持裸写，内容转义", () => {
  const csv = buildCsv(["name", "password"], [["github", "=1+1"]]);
  assert.equal(csv, 'name,password\n"github","\'=1+1"');
});

test("parseCsv 支持引号逗号与 CRLF", () => {
  const csv = 'name,username,password,url,note\r\n"git,hub","alice","p,ass","https://github.com","n""ote"\n';
  const parsed = parseCsv(csv);
  assert.deepEqual(parsed.headers, ["name", "username", "password", "url", "note"]);
  assert.deepEqual(parsed.rows[0], ["git,hub", "alice", "p,ass", "https://github.com", 'n"ote']);
});

test("browserCsvToAccountDrafts 识别常见浏览器列并剥离协议", () => {
  const csv = [
    "url,username,password,note",
    "https://www.Example.com/login,alice,secret,hello",
    "https://github.com,bob,pw,",
  ].join("\n");
  const drafts = browserCsvToAccountDrafts(csv);
  assert.equal(drafts.length, 2);
  assert.deepEqual(drafts[0].sites, ["example.com"]);
  assert.equal(drafts[0].username, "alice");
  assert.equal(drafts[0].password, "secret");
  assert.deepEqual(drafts[1].sites, ["github.com"]);
});

test("accountsToBrowserCsv 往返字段", () => {
  const csv = accountsToBrowserCsv([
    { canonicalSite: "example.com", sites: ["example.com"], username: "a", password: "b", note: "c" },
  ]);
  const drafts = browserCsvToAccountDrafts(csv);
  assert.equal(drafts.length, 1);
  assert.deepEqual(drafts[0].sites, ["example.com"]);
  assert.equal(drafts[0].username, "a");
  assert.equal(drafts[0].password, "b");
  assert.equal(drafts[0].note, "c");
});

test("encode/decode sites", () => {
  assert.equal(encodeSites(["Apple.com", "icloud.com"]), "Apple.com;icloud.com");
  assert.deepEqual(decodeSites(" iCloud.com ; apple.com;icloud.com ; ;APPLE.COM "), [
    "apple.com",
    "icloud.com",
  ]);
});
