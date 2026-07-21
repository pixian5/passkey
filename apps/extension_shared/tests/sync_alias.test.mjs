import test from "node:test";
import assert from "node:assert/strict";
import { syncAliasGroups } from "../../../core/pass_core/js/sync_alias_core.js";
import { ETLD2_SUFFIXES } from "../../../core/pass_core/js/sync_policy.js";

function normalizeDomain(input) {
  let value = String(input || "").trim().toLowerCase();
  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      value = new URL(value).host;
    } catch {
      return "";
    }
  }
  while (value.endsWith(".")) value = value.slice(0, -1);
  return value;
}

function etldPlusOne(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return "";
  if (/^\d+\.\d+\.\d+\.\d+$/.test(normalized) || normalized.includes(":")) {
    return normalized;
  }
  const labels = normalized.split(".").filter(Boolean);
  if (labels.length < 2) return normalized;
  const tail2 = labels.slice(-2).join(".");
  if (ETLD2_SUFFIXES.includes(tail2) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return tail2;
}

const helpers = { normalizeDomain, etldPlusOne };

test("alias groups union by site overlap", () => {
  const accounts = [
    { sites: ["a.example.com"], updatedAtMs: 1, lastOperatedDeviceName: "A" },
    { sites: ["b.example.com", "a.example.com"], updatedAtMs: 1, lastOperatedDeviceName: "A" },
    { sites: ["other.test"], updatedAtMs: 1, lastOperatedDeviceName: "A" },
  ];
  const { accounts: next, changed } = syncAliasGroups(accounts, helpers, {
    nowMs: 99,
    deviceName: "Dev",
  });
  assert.equal(changed, true);
  assert.deepEqual(next[0].sites, ["a.example.com", "b.example.com"]);
  assert.deepEqual(next[1].sites, ["a.example.com", "b.example.com"]);
  assert.deepEqual(next[2].sites, ["other.test"]);
  assert.equal(next[0].updatedAtMs, 99);
  assert.equal(next[0].lastOperatedDeviceName, "Dev");
});

test("alias groups union by same eTLD+1 without exact overlap", () => {
  const accounts = [
    { sites: ["login.example.com"], updatedAtMs: 1 },
    { sites: ["api.example.com"], updatedAtMs: 1 },
  ];
  const { accounts: next, changed } = syncAliasGroups(accounts, helpers, {
    nowMs: 50,
    deviceName: "X",
  });
  assert.equal(changed, true);
  assert.deepEqual(next[0].sites, next[1].sites);
  assert.ok(next[0].sites.includes("login.example.com"));
  assert.ok(next[0].sites.includes("api.example.com"));
});

test("single account alias noop", () => {
  const accounts = [{ sites: ["only.com"] }];
  const { changed } = syncAliasGroups(accounts, helpers, { nowMs: 1, deviceName: "D" });
  assert.equal(changed, false);
});
