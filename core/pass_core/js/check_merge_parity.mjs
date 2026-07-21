#!/usr/bin/env node
/**
 * Parity check: JS sync_merge_core vs Rust pass-merge v2 (via pass-merge-cli).
 *
 * Usage (from repo root):
 *   node core/pass_core/js/check_merge_parity.mjs
 *
 * Requires:
 *   (cd core/pass_core && cargo build -p pass-merge --bin pass-merge-cli)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateSyncSafety,
  mergeAccountCollections,
  mergeFolderCollections,
  mergePasskeyCollections,
} from "./sync_merge_core.js";
import {
  FIXED_NEW_ACCOUNT_FOLDER_ID,
  FIXED_NEW_ACCOUNT_FOLDER_NAME,
  DEFAULT_DEVICE_NAME,
} from "./sync_policy.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const goldenPath = path.join(repoRoot, "docs/sync-golden-vectors.json");
const cliCandidates = [
  path.join(repoRoot, "core/pass_core/target/debug/pass-merge-cli"),
  path.join(repoRoot, "core/pass_core/target/release/pass-merge-cli"),
];

function findCli() {
  for (const candidate of cliCandidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function stableUuidFromText(input) {
  const raw = String(input || "");
  const seedParts = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f];
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    const idx = i % 4;
    seedParts[idx] = Math.imul(seedParts[idx] ^ code, 0x45d9f3b) >>> 0;
    seedParts[idx] = (seedParts[idx] ^ (seedParts[idx] >>> 16)) >>> 0;
  }
  const hex = seedParts.map((value) => value.toString(16).padStart(8, "0")).join("").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function normalizeDomain(input) {
  if (!input) return "";
  let value = String(input).trim().toLowerCase();
  try {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      value = new URL(value).hostname;
    }
  } catch {
    return "";
  }
  while (value.endsWith(".")) value = value.slice(0, -1);
  return value;
}

function etldPlusOne(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return "";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) || normalized.includes(":")) return normalized;
  const labels = normalized.split(".");
  if (labels.length < 2) return normalized;
  return labels.slice(-2).join(".");
}

const helpers = {
  normalizeAccountShape: (value) => ({
    accountId: "account-1",
    recordId: "00000000-0000-0000-0000-000000000001",
    canonicalSite: "example.com",
    createdAtMs: 1,
    updatedAtMs: 1,
    username: "user",
    usernameAtCreate: "user",
    password: "old-password",
    totpSecret: "",
    recoveryCodes: "",
    note: "",
    sites: ["example.com"],
    folderIds: [],
    folderId: null,
    passkeyCredentialIds: [],
    usernameUpdatedAtMs: 1,
    passwordUpdatedAtMs: 1,
    totpUpdatedAtMs: 1,
    recoveryCodesUpdatedAtMs: 1,
    noteUpdatedAtMs: 1,
    passkeyUpdatedAtMs: 1,
    isDeleted: false,
    isPermanentlyDeleted: false,
    deletedAtMs: null,
    lastOperatedDeviceName: DEFAULT_DEVICE_NAME,
    createdDeviceName: DEFAULT_DEVICE_NAME,
    ...value,
  }),
  normalizeFolderIdList: (value) => [
    ...new Set((value || []).map((v) => String(v || "").trim().toLowerCase()).filter(Boolean)),
  ].sort(),
  normalizeFolderId: (value) => String(value || "").trim().toLowerCase(),
  extractAccountFolderIds: (value) => value.folderIds || [],
  normalizeSites: (value) => [
    ...new Set((value || []).map(normalizeDomain).filter(Boolean)),
  ].sort(),
  etldPlusOne,
  normalizePasskeyCredentialIds: (value) => [
    ...new Set((value || []).map((v) => String(v || "").trim()).filter(Boolean)),
  ].sort(),
  stableUuidFromText,
  normalizePasskeyShape: (value) => value,
  normalizePasskeyCreateCompatMethod: (value, alg) => value || (alg === -257 ? "rs256" : "standard"),
  normalizeFolderShape: (value) => ({
    matchedSites: value?.matchedSites || [],
    autoAddMatchingSites: Boolean(value?.autoAddMatchingSites),
    createdAtMs: Number(value?.createdAtMs ?? 0),
    updatedAtMs: Number(value?.updatedAtMs ?? value?.createdAtMs ?? 0),
    isDeleted: Boolean(value?.isDeleted),
    isPermanentlyDeleted: Boolean(value?.isPermanentlyDeleted),
    ...value,
    id: String(value?.id || "").trim().toLowerCase(),
    name: value?.name || FIXED_NEW_ACCOUNT_FOLDER_NAME,
  }),
  sortFoldersForDisplay: (value) => value,
  fixedNewAccountFolderId: FIXED_NEW_ACCOUNT_FOLDER_ID,
  fixedNewAccountFolderName: FIXED_NEW_ACCOUNT_FOLDER_NAME,
};

function runRustMerge(local, remote) {
  const cli = findCli();
  if (!cli) {
    throw new Error(
      "pass-merge-cli not found. Build with: (cd core/pass_core && cargo build -p pass-merge --bin pass-merge-cli)"
    );
  }
  const input = JSON.stringify({ local, remote });
  const result = spawnSync(cli, ["merge", "--stdin"], {
    input,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`rust merge failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function main() {
  const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
  const vector = golden.cases.find((item) => item.name === "field-and-entity-merge");
  assert.ok(vector, "missing field-and-entity-merge");

  const jsAccounts = mergeAccountCollections(vector.local.accounts, vector.remote.accounts, helpers);
  const jsFolders = mergeFolderCollections(vector.local.folders, vector.remote.folders, helpers);
  const jsPasskeys = mergePasskeyCollections(vector.local.passkeys, vector.remote.passkeys, helpers);
  const rustMerged = runRustMerge(vector.local, vector.remote);

  const jsByAccountId = new Map(jsAccounts.map((item) => [item.accountId, item]));
  const rustByAccountId = new Map((rustMerged.accounts || []).map((item) => [item.accountId, item]));

  for (const expected of vector.expected.accounts) {
    const js = jsByAccountId.get(expected.accountId);
    const rust = rustByAccountId.get(expected.accountId);
    assert.ok(js, `js missing ${expected.accountId}`);
    assert.ok(rust, `rust missing ${expected.accountId}`);
    for (const [key, value] of Object.entries(expected)) {
      if (key === "recordId") continue;
      assert.deepEqual(js[key], value, `js ${expected.accountId}.${key}`);
      assert.deepEqual(rust[key], value, `rust ${expected.accountId}.${key}`);
    }
    // Only compare fields the golden vector pins; incomplete fixtures may get
    // different default fill-ins from the JS test helper vs production normalize.
    for (const key of Object.keys(expected)) {
      if (key === "recordId") continue;
      assert.deepEqual(js[key], rust[key], `${expected.accountId} ${key} JS↔Rust parity`);
    }
  }

  assert.equal(jsFolders.find((item) => item.id === "folder-main")?.name, "Updated Main");
  assert.equal((rustMerged.folders || []).find((item) => item.id === "folder-main")?.name, "Updated Main");
  assert.equal(jsPasskeys.find((item) => item.credentialIdB64u === "credential-local")?.signCount, 9);
  assert.equal(
    (rustMerged.passkeys || []).find((item) => item.credentialIdB64u === "credential-local")?.signCount,
    9
  );

  const empty = golden.cases.find((item) => item.name === "empty-remote-safety");
  const safety = evaluateSyncSafety(
    {
      local: { accounts: [helpers.normalizeAccountShape({ recordId: "golden-local", accountId: "local" })] },
      remote: { accounts: [] },
      merged: { accounts: [] },
      mode: "remoteOverwriteLocal",
    },
    helpers
  );
  assert.equal(safety.safe, empty.expectedSafe);
  assert.equal(safety.reasons[0], empty.reason);

  console.log("merge parity OK: JS sync_merge_core ↔ Rust pass-merge v2");
}

main();
