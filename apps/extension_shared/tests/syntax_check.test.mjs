import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");

function findFiles(dir, extensions) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Avoid node_modules or build directories
      if (entry.name !== "node_modules" && entry.name !== "dist" && entry.name !== ".git" && entry.name !== "target") {
        results.push(...findFiles(fullPath, extensions));
      }
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

test("syntax check: all monorepo JavaScript and MJS source files parse cleanly without syntax errors", () => {
  const targetDirs = [
    path.join(REPO_ROOT, "apps/codex-tauri/src"),
    path.join(REPO_ROOT, "apps/codex-tauri/scripts"),
    path.join(REPO_ROOT, "apps/extension_shared"),
    path.join(REPO_ROOT, "scripts"),
  ];

  const allFiles = targetDirs.flatMap((dir) => findFiles(dir, [".js", ".mjs"]));
  assert.equal(allFiles.length > 50, true, `Found ${allFiles.length} files to check, expected at least 50`);

  const errors = [];
  for (const filePath of allFiles) {
    try {
      execFileSync(process.execPath, ["--check", filePath], { stdio: "pipe" });
    } catch (err) {
      const relPath = path.relative(REPO_ROOT, filePath);
      errors.push(`${relPath}: ${err.message || String(err)}`);
    }
  }

  assert.deepEqual(errors, [], `Syntax check failures encountered:\n${errors.join("\n")}`);
});
