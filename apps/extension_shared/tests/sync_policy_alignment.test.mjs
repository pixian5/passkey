import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DEVICE_NAME,
  ETLD2_SUFFIXES,
  FIXED_NEW_ACCOUNT_FOLDER_ID,
  FIXED_NEW_ACCOUNT_FOLDER_NAME,
  SYNC_OUTBOX_BASE_DELAY_MS,
  SYNC_OUTBOX_MAX_ATTEMPTS,
  SYNC_OUTBOX_MAX_DELAY_MS,
  SYNC_PUSH_CONFLICT_MAX_ATTEMPTS,
  syncOutboxRetryDelayMs,
} from "../../../core/pass_core/js/sync_policy.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const swiftPolicyPath = path.join(
  repositoryRoot,
  "apps/app_macos/Sources/shared/PassSyncPolicy.swift"
);

function readSwiftPolicy() {
  return fs.readFileSync(swiftPolicyPath, "utf8");
}

function extractSwiftString(source, name) {
  const match = source.match(new RegExp(`static let ${name} = "([^"]+)"`));
  assert.ok(match, `missing Swift string constant: ${name}`);
  return match[1];
}

function extractSwiftInt(source, name) {
  // Supports simple integer expressions used in PassSyncPolicy, e.g. `60 * 60`.
  const match = source.match(new RegExp(`static let ${name} = ([0-9*+\\-\\s]+)`));
  assert.ok(match, `missing Swift int constant: ${name}`);
  const expression = match[1].replace(/\s+/g, "");
  assert.match(expression, /^[0-9*+\-]+$/, `unsafe Swift int expression for ${name}: ${expression}`);
  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${expression});`)();
  assert.equal(typeof value, "number");
  assert.ok(Number.isFinite(value), `non-finite Swift int for ${name}`);
  return value;
}

function extractSwiftUuid(source, name) {
  const match = source.match(
    new RegExp(`static let ${name} = UUID\\(uuidString: "([0-9A-Fa-f-]+)"\\)!`)
  );
  assert.ok(match, `missing Swift UUID constant: ${name}`);
  return match[1].toLowerCase();
}

function extractSwiftStringSet(source, name) {
  const match = source.match(
    new RegExp(`static let ${name}: Set<String> = \\[([\\s\\S]*?)\\]`, "m")
  );
  assert.ok(match, `missing Swift string set: ${name}`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]).sort();
}

test("JS sync_policy 与 PassSyncPolicy.swift 常量保持对齐", () => {
  const swift = readSwiftPolicy();

  assert.equal(DEFAULT_DEVICE_NAME, extractSwiftString(swift, "defaultDeviceName"));
  assert.equal(FIXED_NEW_ACCOUNT_FOLDER_NAME, extractSwiftString(swift, "fixedNewAccountFolderName"));
  assert.equal(
    FIXED_NEW_ACCOUNT_FOLDER_ID.toLowerCase(),
    extractSwiftUuid(swift, "fixedNewAccountFolderId")
  );
  assert.deepEqual([...ETLD2_SUFFIXES].sort(), extractSwiftStringSet(swift, "etld2Suffixes"));
  assert.equal(SYNC_OUTBOX_MAX_ATTEMPTS, extractSwiftInt(swift, "syncOutboxMaxAttempts"));
  assert.equal(SYNC_OUTBOX_BASE_DELAY_MS, extractSwiftInt(swift, "syncOutboxBaseDelaySeconds") * 1000);
  assert.equal(SYNC_OUTBOX_MAX_DELAY_MS, extractSwiftInt(swift, "syncOutboxMaxDelaySeconds") * 1000);
  assert.equal(
    SYNC_PUSH_CONFLICT_MAX_ATTEMPTS,
    extractSwiftInt(swift, "syncPushConflictMaxAttempts")
  );
});

test("outbox 退避曲线与 Swift 秒级实现一致", () => {
  const swift = readSwiftPolicy();
  const baseSeconds = extractSwiftInt(swift, "syncOutboxBaseDelaySeconds");
  const maxSeconds = extractSwiftInt(swift, "syncOutboxMaxDelaySeconds");

  for (const attempts of [1, 2, 3, 5, 9, 12, 20]) {
    const exponent = Math.max(0, Math.min(attempts - 1, 8));
    const expectedSeconds = Math.min(maxSeconds, baseSeconds * (2 ** exponent));
    assert.equal(syncOutboxRetryDelayMs(attempts), expectedSeconds * 1000);
  }
});

test("共享/壳层 manifest 名称与版本正确", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "apps/extension_shared/package.json"), "utf8")
  );
  const version = packageJson.version;

  const expected = [
    ["apps/extension_shared/manifest.json", "Pass"],
    ["apps/extension_chrome/manifest.json", "Pass - Chrome Extension"],
    ["apps/extension_firefox/manifest.json", "Pass - Firefox Extension"],
  ];

  for (const [relativePath, name] of expected) {
    const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8"));
    assert.equal(manifest.version, version, `${relativePath} version`);
    assert.equal(manifest.name, name, `${relativePath} name`);
  }
});
