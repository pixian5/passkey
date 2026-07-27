import test from "node:test";
import assert from "node:assert/strict";

// Mirrors the fixed preview identity key rule used by UI/options:
// stable recordId/id must beat accountId so tombstones do not look like adds.
function previewRecordKey(record, fallbackPrefix = "account") {
  return String(
    record?.recordId?.trim()
      || record?.id?.trim()
      || record?.accountId?.trim()
      || `${fallbackPrefix}:${record?.canonicalSite || ""}:${record?.username || ""}`
  ).toLowerCase();
}

test("preview identity prefers recordId over accountId", () => {
  const local = { recordId: "r1", accountId: "apple.com2026alice", username: "alice" };
  const merged = { recordId: "r1", accountId: "apple.com2026alice-renamed", username: "alice" };
  assert.equal(previewRecordKey(local), previewRecordKey(merged));
});

test("permanent tombstone with same recordId is not treated as a different account", () => {
  const local = { recordId: "r-del", accountId: "x", isPermanentlyDeleted: true };
  const merged = { recordId: "r-del", accountId: "x", isPermanentlyDeleted: true };
  assert.equal(previewRecordKey(local), "r-del");
  assert.equal(previewRecordKey(local), previewRecordKey(merged));
});
