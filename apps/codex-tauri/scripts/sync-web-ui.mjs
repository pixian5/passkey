import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(root, "../..");
const extensionDir = resolve(repoRoot, "apps/extension_chrome_web");

const sourceMain = resolve(root, "src/main.js");
const sourceStyles = resolve(root, "src/styles.css");
const sourceHtml = resolve(root, "index.html");
const coreJs = resolve(repoRoot, "core/pass_core/js/sync_merge_core.js");
const corePolicyJs = resolve(repoRoot, "core/pass_core/js/sync_policy.js");

async function syncExtensionUi() {
  await mkdir(extensionDir, { recursive: true });
  // Single UI source: copy Tauri/Web management page into the Chrome web-options surface.
  await cp(sourceMain, resolve(extensionDir, "web-main.js"));
  await cp(sourceStyles, resolve(extensionDir, "web-options.css"));
  await cp(coreJs, resolve(extensionDir, "sync_merge_core.js"));
  await cp(corePolicyJs, resolve(extensionDir, "sync_policy.js"));

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
