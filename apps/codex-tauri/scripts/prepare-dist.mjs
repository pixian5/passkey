import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "src"), { recursive: true });
await mkdir(resolve(dist, "vendor"), { recursive: true });
await cp(resolve(root, "index.html"), resolve(dist, "index.html"));
await cp(resolve(root, "src", "main.js"), resolve(dist, "src", "main.js"));
await cp(resolve(root, "src", "sync_outbox_scheduler.js"), resolve(dist, "src", "sync_outbox_scheduler.js"));
await cp(resolve(root, "src", "styles.css"), resolve(dist, "src", "styles.css"));
await cp(resolve(root, "node_modules", "jsqr", "dist", "jsQR.js"), resolve(dist, "vendor", "jsQR.js"));

// Keep the Chrome web-options surface generated from the same UI source.
const sync = spawnSync(process.execPath, [resolve(root, "scripts/sync-web-ui.mjs")], {
  stdio: "inherit",
});
if (sync.status !== 0) {
  process.exit(sync.status ?? 1);
}

console.log("dist prepared:", dist);
