import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(testDir, "..");
const repoDir = path.resolve(appDir, "..", "..");

async function readManifest(relativePath) {
  return JSON.parse(await readFile(path.join(repoDir, relativePath), "utf8"));
}

function findMainWorldPasskeyScript(manifest) {
  return manifest.content_scripts.find((entry) => (
    entry.world === "MAIN" && entry.js?.includes("dist/webauthn_injected.js")
  ));
}

test("Chrome 和 Firefox 在所有框架最早注入 WebAuthn 桥接", async () => {
  for (const manifestPath of [
    "apps/extension_shared/manifest.json",
    "apps/extension_chrome_web/manifest.json",
    "apps/extension_firefox/manifest.json",
  ]) {
    const entry = findMainWorldPasskeyScript(await readManifest(manifestPath));
    assert.ok(entry, `${manifestPath} 缺少主世界 WebAuthn 注入`);
    assert.equal(entry.run_at, "document_start", `${manifestPath} 注入时机`);
    assert.equal(entry.all_frames, true, `${manifestPath} 必须覆盖认证子框架`);
    assert.equal(entry.match_about_blank, true, `${manifestPath} 必须覆盖 about:blank 认证框架`);
  }
});

test("Chrome 弹窗包含注册诊断控件，和打包脚本保持一致", async () => {
  const chromePopup = await readFile(path.join(repoDir, "apps/extension_chrome_web/popup.html"), "utf8");
  const sharedPopup = await readFile(path.join(repoDir, "apps/extension_shared/popup.html"), "utf8");
  const chromePopupCss = await readFile(path.join(repoDir, "apps/extension_chrome_web/popup.css"), "utf8");
  const sharedPopupCss = await readFile(path.join(repoDir, "apps/extension_shared/popup.css"), "utf8");
  assert.match(chromePopup, /id="copyPasskeyCreateDiagnostic"/);
  assert.match(chromePopup, /id="clearPasskeyDiagnostics"/);
  assert.equal(chromePopup, sharedPopup);
  assert.equal(chromePopupCss, sharedPopupCss);
});

test("Chrome 不声明未实现的远程桌面 WebAuthn 代理", async () => {
  const chromeManifest = await readManifest("apps/extension_chrome_web/manifest.json");
  assert.equal(chromeManifest.permissions.includes("webAuthenticationProxy"), false);
});
