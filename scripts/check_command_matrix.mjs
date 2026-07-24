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

const ext = new Set([...read("apps/extension_chrome_web/extension-bridge.js").matchAll(/case\s+"([a-zA-Z0-9_]+)":/g)].map((m) => m[1]));
const webSrc = read("apps/pass-web/src/main.rs");
const web = new Set();
for (const m of webSrc.matchAll(/"([a-zA-Z0-9_]+)"(?:\s*\|\s*"([a-zA-Z0-9_]+)")*\s*=>/g)) {
  for (const token of m[0].matchAll(/"([a-zA-Z0-9_]+)"/g)) web.add(token[1]);
}
const tauriSrc = read("apps/codex-tauri/src-tauri/src/main.rs");
const handler = tauriSrc.match(/generate_handler!\[([\s\S]*?)\]/)?.[1] || "";
const tauri = new Set([...handler.matchAll(/([a-zA-Z0-9_]+)/g)].map((m) => m[1]));

const missing = {
  extension: [...ui].filter((cmd) => !ext.has(cmd)).sort(),
  web: [...ui].filter((cmd) => !web.has(cmd)).sort(),
  tauri: [...ui].filter((cmd) => !tauri.has(cmd)).sort(),
};

const errors = [];
for (const [surface, list] of Object.entries(missing)) {
  if (list.length) errors.push(`UI commands missing in ${surface}: ${list.join(", ")}`);
}

// Extension must not fake unsupported platform features.
const extSrc = read("apps/extension_chrome_web/extension-bridge.js");
const mustError = [
  ["sync_webdav_now_mode", /case "sync_webdav_now_mode":\s*throw new Error/],
  ["provision_self_hosted_server", /case "provision_self_hosted_server":\s*throw new Error/],
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

if (errors.length) {
  console.error("command matrix check failed:\n- " + errors.join("\n- "));
  process.exit(1);
}

console.log(`command matrix OK: UI ${ui.size}; tauri/web/extension cover all UI commands`);
