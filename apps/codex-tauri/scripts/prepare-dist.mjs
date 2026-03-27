import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "src"), { recursive: true });
await cp(resolve(root, "index.html"), resolve(dist, "index.html"));
await cp(resolve(root, "src", "main.js"), resolve(dist, "src", "main.js"));
await cp(resolve(root, "src", "styles.css"), resolve(dist, "src", "styles.css"));

console.log("dist prepared:", dist);
