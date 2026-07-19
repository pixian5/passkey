import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const schemaDirectory = path.join(repositoryRoot, "docs/schemas");
const dataSchema = JSON.parse(fs.readFileSync(path.join(schemaDirectory, "pass-data-v2.schema.json"), "utf8"));
const bundleSchema = JSON.parse(fs.readFileSync(path.join(schemaDirectory, "pass-sync-bundle-v2.schema.json"), "utf8"));

function buildValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(dataSchema);
  return ajv.compile(bundleSchema);
}

function sampleBundle() {
  const id = "00000000-0000-0000-0000-000000000001";
  return {
    schema: "pass.sync.bundle.v2",
    exportedAtMs: 100,
    source: { app: "pass-extension", platform: "chrome-extension", deviceName: "ChromeMac", deviceId: id, logicalClockMs: 100, formatVersion: 2 },
    payload: {
      accounts: [{
        recordId: id, accountId: "example-1-user", canonicalSite: "example.com", usernameAtCreate: "user",
        isPinned: false, pinnedSortOrder: null, regularSortOrder: null,
        pinnedViews: { all: { pinned: false, pinnedSortOrder: null, regularSortOrder: null } },
        folderId: null, folderIds: [], folderMembershipStates: {},
        sites: ["example.com"], siteAliasStates: { "example.com": { isDeleted: false, updatedAtMs: 100, deviceName: "ChromeMac" } },
        username: "user", password: "secret", totpSecret: "", recoveryCodes: "", note: "",
        passkeyCredentialIds: [], passkeyLinkStates: {},
        usernameUpdatedAtMs: 100, usernameUpdatedDeviceName: "ChromeMac", passwordUpdatedAtMs: 100, passwordUpdatedDeviceName: "ChromeMac",
        totpUpdatedAtMs: 100, totpUpdatedDeviceName: "ChromeMac", recoveryCodesUpdatedAtMs: 100, recoveryCodesUpdatedDeviceName: "ChromeMac",
        noteUpdatedAtMs: 100, noteUpdatedDeviceName: "ChromeMac", passkeyUpdatedAtMs: 100, passkeyUpdatedDeviceName: "ChromeMac",
        isDeleted: false, isPermanentlyDeleted: false, deletedAtMs: null, deletedDeviceName: "",
        lastOperatedDeviceName: "ChromeMac", createdDeviceName: "ChromeMac", createdAtMs: 100, updatedAtMs: 100,
      }],
      folders: [{ id: "00000000-0000-0000-0000-000000000002", name: "Folder", matchedSites: [], autoAddMatchingSites: false, isDeleted: false, isPermanentlyDeleted: false, deletedAtMs: null, deletedDeviceName: "", createdAtMs: 100, updatedAtMs: 100 }],
      passkeys: [],
    },
  };
}

test("实际同步字段组合符合 v2 Schema", () => {
  const validate = buildValidator();
  assert.equal(validate(sampleBundle()), true, JSON.stringify(validate.errors));
});

test("Schema 拒绝未声明的同步字段", () => {
  const validate = buildValidator();
  const bundle = sampleBundle();
  bundle.payload.accounts[0].unexpectedField = true;
  assert.equal(validate(bundle), false);
});
