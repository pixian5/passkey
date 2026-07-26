#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markdownFiles = [];

function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "target", "dist", ".venv"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(fullPath);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) markdownFiles.push(fullPath);
  }
}

function isExternal(target) {
  return target.startsWith("#") || target.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(target);
}

collect(root);
const failures = [];
const markdownLinkPattern = /!?\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g;

for (const filePath of markdownFiles) {
  const source = fs.readFileSync(filePath, "utf8");
  for (const match of source.matchAll(markdownLinkPattern)) {
    let target = match[1];
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (isExternal(target)) continue;
    const localTarget = target.split("#", 1)[0].split("?", 1)[0];
    if (!localTarget) continue;
    const resolved = path.resolve(path.dirname(filePath), localTarget);
    if (!fs.existsSync(resolved)) {
      const line = source.slice(0, match.index).split("\n").length;
      failures.push(`${path.relative(root, filePath)}:${line} -> ${target}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Markdown local link check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Markdown local links OK (${markdownFiles.length} files)`);
