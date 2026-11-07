import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "../..");
const extensionDir = resolve(repoRoot, "apps/extension_chrome_web");

const sourceMain = resolve(root, "src/main.js");
const sourceAdapter = resolve(root, "src/adapter.js");
const sourceTotp = resolve(root, "src/totp.js");
const sourceUiUtils = resolve(root, "src/ui_utils.js");
const sourceVaultFilters = resolve(root, "src/vault_filters.js");
const sourceStore = resolve(root, "src/store.js");
const sourceDialog = resolve(root, "src/dialog.js");
const sourceDedup = resolve(root, "src/dedup.js");
const sourceSyncPreview = resolve(root, "src/sync_preview.js");
const sourceStyles = resolve(root, "src/styles.css");
const sourceSyncOutboxScheduler = resolve(root, "src/sync_outbox_scheduler.js");
const sourceAppVersion = resolve(root, "src/app_version.js");
const sourceHtml = resolve(root, "index.html");
const coreJs = resolve(repoRoot, "core/pass_core/js/sync_merge_core.js");
const csvCoreJs = resolve(repoRoot, "core/pass_core/js/csv_core.js");
const vaultMutateCoreJs = resolve(repoRoot, "core/pass_core/js/vault_mutate_core.js");
const corePolicyJs = resolve(repoRoot, "core/pass_core/js/sync_policy.js");
const coreAliasJs = resolve(repoRoot, "core/pass_core/js/sync_alias_core.js");

async function syncExtensionUi() {
  await mkdir(extensionDir, { recursive: true });
  // Single UI source: copy Tauri/Web management page into the Chrome web-options surface.
  await cp(sourceMain, resolve(extensionDir, "web-main.js"));
  await cp(sourceAdapter, resolve(extensionDir, "adapter.js"));
  await cp(sourceTotp, resolve(extensionDir, "totp.js"));
  await cp(sourceUiUtils, resolve(extensionDir, "ui_utils.js"));
  await cp(sourceVaultFilters, resolve(extensionDir, "vault_filters.js"));
  await cp(sourceStore, resolve(extensionDir, "store.js"));
  await cp(sourceDialog, resolve(extensionDir, "dialog.js"));
  await cp(sourceDedup, resolve(extensionDir, "dedup.js"));
  await cp(sourceSyncPreview, resolve(extensionDir, "sync_preview.js"));
  await cp(sourceStyles, resolve(extensionDir, "web-options.css"));
  await cp(sourceSyncOutboxScheduler, resolve(extensionDir, "sync_outbox_scheduler.js"));
  await cp(sourceAppVersion, resolve(extensionDir, "app_version.js"));
  await cp(coreJs, resolve(extensionDir, "sync_merge_core.js"));
  await cp(csvCoreJs, resolve(extensionDir, "csv_core.js"));
  await cp(vaultMutateCoreJs, resolve(extensionDir, "vault_mutate_core.js"));
  await cp(corePolicyJs, resolve(extensionDir, "sync_policy.js"));
  await cp(coreAliasJs, resolve(extensionDir, "sync_alias_core.js"));

  let html = await readFile(sourceHtml, "utf8");
  html = html
    .replaceAll('href="/src/styles.css"', 'href="./web-options.css"')
    .replaceAll('<script src="/vendor/jsQR.js"></script>', '<script src="./vendor/jsQR.js"></script>')
    .replaceAll(
      '<script type="module" src="/src/main.js"></script>',
      '<script type="module" src="./extension-bridge.js"></script>\n    <script type="module" src="./web-main.js"></script>'
    );
  await writeFile(resolve(extensionDir, "web-options.html"), html, "utf8");
  console.log("Synced shared web UI into", extensionDir);
}

await syncExtensionUi();
