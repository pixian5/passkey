#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const uiSrc = read("apps/codex-tauri/src/main.js");
const ui = new Set([...uiSrc.matchAll(/invoke\(\s*["']([a-zA-Z0-9_]+)["']/g)].map((m) => m[1]));
for (const cmd of ["sync_now_mode", "sync_webdav_now_mode"]) {
  if (uiSrc.includes(cmd)) ui.add(cmd);
}
const commandCount = ui.size;

const commandCountDocs = [
  "docs/current-app-extension-implementation-reference-zh.md",
  "docs/three-surface-command-matrix-zh.md",
  "docs/three-surface-unification-zh.md",
];
const renderCommandCountDoc = (source) => source
  .replace(/UI 当前调用 \d+ 个命令/g, `UI 当前调用 ${commandCount} 个命令`)
  .replace(/统一管理 UI 与 \d+ 个 UI 命令入口/g, `统一管理 UI 与 ${commandCount} 个 UI 命令入口`)
  .replace(/命令覆盖 \d+\/\d+/g, `命令覆盖 ${commandCount}/${commandCount}`)
  .replace(/边界：\d+\/\d+/g, `边界：${commandCount}/${commandCount}`)
  .replace(/UI 命令数：\d+/g, `UI 命令数：${commandCount}`)
  .replace(/扩展覆盖：\d+\/\d+/g, `扩展覆盖：${commandCount}/${commandCount}`)
  .replace(/Docker Web 覆盖：\d+\/\d+/g, `Docker Web 覆盖：${commandCount}/${commandCount}`)
  .replace(/Tauri 覆盖：\d+\/\d+/g, `Tauri 覆盖：${commandCount}/${commandCount}`);

if (process.argv.includes("--write-docs")) {
  for (const rel of commandCountDocs) {
    const source = read(rel);
    fs.writeFileSync(path.join(root, rel), renderCommandCountDoc(source));
  }
}

const ext = new Set([...read("apps/extension_chrome_web/extension-bridge.js").matchAll(/case\s+"([a-zA-Z0-9_]+)":/g)].map((m) => m[1]));
const webSrc = read("apps/pass-web/src/main.rs");
const web = new Set();
for (const m of webSrc.matchAll(/"([a-zA-Z0-9_]+)"(?:\s*\|\s*"([a-zA-Z0-9_]+)")*\s*=>/g)) {
  for (const token of m[0].matchAll(/"([a-zA-Z0-9_]+)"/g)) web.add(token[1]);
}
const tauriSrc = read("apps/codex-tauri/src-tauri/src/main.rs");
const syncReportSrc = read("core/pass_core/crates/merge/src/v2/report.rs");
const syncReportSchema = JSON.parse(read("docs/schemas/sync-operation-report-v1.schema.json"));
const handler = tauriSrc.match(/generate_handler!\[([\s\S]*?)\]/)?.[1] || "";
const tauri = new Set([...handler.matchAll(/([a-zA-Z0-9_]+)/g)].map((m) => m[1]));

const missing = {
  extension: [...ui].filter((cmd) => !ext.has(cmd)).sort(),
  web: [...ui].filter((cmd) => !web.has(cmd)).sort(),
  tauri: [...ui].filter((cmd) => !tauri.has(cmd)).sort(),
};

const errors = [];
for (const rel of commandCountDocs) {
  const source = read(rel);
  if (source !== renderCommandCountDoc(source)) {
    errors.push(`${rel} command count is stale; run node scripts/check_command_matrix.mjs --write-docs`);
  }
}
for (const [surface, list] of Object.entries(missing)) {
  if (list.length) errors.push(`UI commands missing in ${surface}: ${list.join(", ")}`);
}

// A sync result is consumed by all surfaces, so keep its on-wire JSON shape
// explicit. This is intentionally dependency-free: the gate checks the Rust
// source fields against the JSON Schema and validates a representative report.
const requiredSyncReport = [
  ["reportVersion", "report_version"],
  ["ok", "ok"],
  ["dryRun", "dry_run"],
  ["mode", "mode"],
  ["message", "message"],
  ["safe", "safe"],
  ["safety", "safety"],
  ["reasons", "reasons"],
  ["localAccounts", "local_accounts"],
  ["remoteAccounts", "remote_accounts"],
  ["mergedAccounts", "merged_accounts"],
  ["applied", "applied"],
  ["pushed", "pushed"],
  ["remotePulled", "remote_pulled"],
  ["pendingRetry", "pending_retry"],
  ["retryable", "retryable"],
  ["stage", "stage"],
  ["source", "source"],
  ["syncSessionId", "sync_session_id"],
  ["operationId", "operation_id"],
];
if (syncReportSchema.additionalProperties !== false) {
  errors.push("sync operation report schema must reject undeclared fields");
}
for (const [jsonField, rustField] of requiredSyncReport) {
  if (!syncReportSchema.required?.includes(jsonField)) {
    errors.push(`sync operation report schema missing required field: ${jsonField}`);
  }
  if (!Object.hasOwn(syncReportSchema.properties || {}, jsonField)) {
    errors.push(`sync operation report schema missing property: ${jsonField}`);
  }
  if (!new RegExp(`pub ${rustField}:`).test(syncReportSrc)) {
    errors.push(`SyncOperationReport missing Rust field: ${rustField}`);
  }
}
for (const optionalField of ["code", "etag", "revision"]) {
  if (!Object.hasOwn(syncReportSchema.properties || {}, optionalField)) {
    errors.push(`sync operation report schema missing optional property: ${optionalField}`);
  }
}
if (!/pub const SYNC_REPORT_VERSION:\s*u32\s*=\s*1;/.test(syncReportSrc)) {
  errors.push("sync operation report version must remain 1 until a coordinated protocol bump");
}

// Extension must not fake unsupported platform features.
const extSrc = read("apps/extension_chrome_web/extension-bridge.js");
const extensionBackgroundSrc = read("apps/extension_shared/background.js");
const sharedUiSrc = read("apps/codex-tauri/src/main.js");
const exchangeSrc = read("apps/codex-tauri/src-tauri/src/exchange.rs");
const mustError = [
  ["provision_self_hosted_server", /case "provision_self_hosted_server":\s*throw new Error/],
  ["inspect_ssh_host_key_cmd", /case "inspect_ssh_host_key_cmd":\s*throw new Error/],
  ["trust_ssh_host_key_cmd", /case "trust_ssh_host_key_cmd":\s*throw new Error/],
  ["lock_unlock_biometric", /case "lock_unlock_biometric":\s*throw new Error/],
];
for (const [cmd, re] of mustError) {
  if (!re.test(extSrc)) errors.push(`extension must throw for unsupported command: ${cmd}`);
}
if (!/case "list_server_versions":/.test(extSrc) || /case "list_server_versions":\s*return \[\]/.test(extSrc)) {
  // empty-list stub no longer allowed once serverVersions capability is enabled
  if (/case "list_server_versions":\s*return \[\]/.test(extSrc)) {
    errors.push('extension list_server_versions must call /v2/sync/versions instead of returning []');
  } else if (!/case "list_server_versions":/.test(extSrc)) {
    errors.push('extension list_server_versions missing');
  }
}
if (!/case "restore_server_version":[\s\S]*?\/v2\/sync\/versions\//.test(extSrc)) {
  errors.push('extension restore_server_version must download /v2/sync/versions/{id}');
}
if (!/serverVersions:\s*true/.test(extSrc)) {
  errors.push('extension health_check.capabilities.serverVersions must be true');
}
if (!/webdavSync:\s*true/.test(extSrc) || !/managedMultiSourceSync:\s*true/.test(extSrc)) {
  errors.push('extension must advertise background-managed WebDAV and multi-source sync');
}
if (!/case "sync_webdav_now_mode":[\s\S]*?PASS_SYNC_RUN/.test(extSrc)) {
  errors.push('extension sync_webdav_now_mode must delegate to the background sync engine');
}
if (!/if \(platformCapabilities\.managedMultiSourceSync\)[\s\S]*?invoke\("sync_now_mode"/.test(sharedUiSrc)) {
  errors.push('shared UI must invoke managed multi-source backends exactly through sync_now_mode');
}
if (!/case "verify_sync_endpoint":[\s\S]*?\/healthz/.test(extSrc)) {
  errors.push('extension verify_sync_endpoint must use the server /healthz endpoint');
}
if (/async function syncRemote\(/.test(extSrc)) {
  errors.push("Chrome Web adapter must delegate sync to the background instead of keeping a second sync engine");
}
for (const messageType of [
  "PASS_WEB_SYNC_CONFIGURE",
  "PASS_SYNC_RUN",
  "PASS_SYNC_OUTBOX_STATUS",
  "PASS_SYNC_OUTBOX_CLEAR_INACTIVE",
  "PASS_SYNC_SNAPSHOTS_LIST",
  "PASS_SYNC_SNAPSHOT_RESTORE",
]) {
  if (!extSrc.includes(messageType) || !extensionBackgroundSrc.includes(`case "${messageType}"`)) {
    errors.push(`Chrome Web/background sync message contract missing: ${messageType}`);
  }
}
if (/case "get_sync_outbox_status":\s*return \[\]/.test(extSrc)) {
  errors.push("Chrome Web outbox status must come from the encrypted background queue");
}
const localConcurrencySyncBlock = extensionBackgroundSrc.match(
  /if \(!syncPayloadEquals\(currentPayload, pulledLocalPayload\)\) \{[\s\S]*?\n  \}/,
)?.[0] || "";
if (!/stage:\s*"checkingLocalConcurrency"/.test(localConcurrencySyncBlock) || !/retryable:\s*true/.test(localConcurrencySyncBlock)) {
  errors.push("Chrome background must return a retryable structured report when local data changes during pull");
}
if (!/const primaryReportSource = primaryTarget\.kind === "server" \? "selfHosted" : primaryTarget\.kind/.test(extensionBackgroundSrc)
  || (extensionBackgroundSrc.match(/source:\s*primaryReportSource/g) || []).length < 4) {
  errors.push("Chrome background sync reports must map and expose the actual primary target");
}

// Count-return contracts in extension.
const countCommands = [
  "soft_delete_accounts",
  "restore_all_deleted_accounts",
  "hard_delete_all_deleted_accounts",
];
for (const cmd of countCommands) {
  const re = new RegExp(`case "${cmd}":[\\s\\S]*?return (count|restored\\.length|removed);`);
  // looser: ensure mutate body returns a count-like expression near end
  const block = extSrc.match(new RegExp(`case "${cmd}":[\\s\\S]*?(?=case "|$)`))?.[0] || "";
  if (!/return (count|restored\.length)/.test(block) && !/return count;/.test(block)) {
    // hard_delete returns count variable
    if (!(cmd === "hard_delete_all_deleted_accounts" && /return count;/.test(block))) {
      if (!/return count;/.test(block) && !/return restored\.length/.test(block)) {
        errors.push(`extension ${cmd} should return count number`);
      }
    }
  }
}

// Rust soft_delete should return count now.
if (!/fn soft_delete_accounts\([\s\S]*?\) -> Result<usize, String>/.test(tauriSrc)) {
  errors.push("tauri soft_delete_accounts must return Result<usize, String>");
}
if (!/Ok\(count\)\s*\}\s*"restore_account"/.test(webSrc.replace(/\s+/g, " ")) && !/Ok\(json!\(count\)\)\s*\}\s*"restore_account"/.test(webSrc.replace(/\s+/g, " "))) {
  // fallback search
  if (!/soft_delete_accounts[\s\S]*Ok\(json!\(count\)\)/.test(webSrc)) {
    errors.push("pass-web soft_delete_accounts must return json!(count)");
  }
}

// High-risk synchronization commands use structured JSON values on native
// and server surfaces. Tauri previously serialized these values to strings,
// while pass-web wrapped an already serialized string in JSON once more.
for (const cmd of [
  "sync_preview",
  "sync_now",
  "sync_now_mode",
  "sync_webdav_now_mode",
  "import_sync_bundle",
  "import_sync_bundle_text",
]) {
  const tauriFn = tauriSrc.match(
    new RegExp(`(?:async )?fn ${cmd}\\([\\s\\S]*?\\) -> Result<([^>]+), String>`),
  );
  if (!tauriFn || !tauriFn[1].includes("serde_json::Value")) {
    errors.push(`tauri ${cmd} must return Result<serde_json::Value, String>`);
  }
}
if (/Ok\(json!\(serde_json::to_string\(&json!\(/.test(webSrc)) {
  errors.push("pass-web must not wrap command JSON objects as JSON strings");
}
if (!/pub local_payload:\s*SyncPayload/.test(exchangeSrc) || !/\"localPayload\": local/.test(webSrc) || !/localPayload:\s*local/.test(extSrc)) {
  errors.push("sync bundle import must expose localPayload on all surfaces");
}

// Mutating commands that do not return a domain object or count use the same
// explicit success value on every surface. A null/array/object here usually
// means one adapter was left on an older implementation.
const booleanSuccessCommands = [
  "delete_folder",
  "set_account_folders",
  "set_accounts_folders",
  "set_accounts_pinned",
  "restore_account",
  "hard_delete_account",
];
for (const cmd of booleanSuccessCommands) {
  const tauriFn = tauriSrc.match(new RegExp(`(?:async )?fn ${cmd}\\([\\s\\S]*?\\) -> Result<([^>]+), String>`));
  if (!tauriFn || !tauriFn[1].includes("bool")) {
    errors.push(`tauri ${cmd} must return Result<bool, String>`);
  }
  const webBlock = webSrc.match(new RegExp(`\\"${cmd}\\"\\s*=>[\\s\\S]*?(?=\\n\\s*\\"[a-zA-Z0-9_]+\\"\\s*=>|\\n\\s*_\\s*=>|$)`))?.[0] || "";
  if (!/Ok\(json!\(true\)\)/.test(webBlock)) {
    errors.push(`pass-web ${cmd} must return true on success`);
  }
  const extBlock = extSrc.match(new RegExp(`case \\"${cmd}\\":[\\s\\S]*?(?=case \\"|default:)`))?.[0] || "";
  if (!/return true;/.test(extBlock)) {
    errors.push(`extension ${cmd} must return true on success`);
  }
}
for (const cmd of [
  "undo_last_operation",
  "redo_last_operation",
  "restore_server_version",
  "restore_local_snapshot",
]) {
  const tauriFn = tauriSrc.match(
    new RegExp(`(?:async )?fn ${cmd}\\([\\s\\S]*?\\) -> Result<([^>]+), String>`),
  );
  if (!tauriFn || !tauriFn[1].includes("serde_json::Value")) {
    errors.push(`tauri ${cmd} must return an object with message`);
  }
  const extBlock = extSrc.match(new RegExp(`case "${cmd}":[\\s\\S]*?(?=case "|default:)`))?.[0] || "";
  if (!/message:/.test(extBlock)) {
    errors.push(`extension ${cmd} must return an object with message`);
  }
}

if (errors.length) {
  console.error("command matrix check failed:\n- " + errors.join("\n- "));
  process.exit(1);
}

console.log(`command matrix OK: UI ${ui.size}; tauri/web/extension cover all UI commands`);
