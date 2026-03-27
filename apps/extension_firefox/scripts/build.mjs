import path from "node:path";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const outDir = path.join(rootDir, "dist");
const watchMode = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: {
    popup: path.join(rootDir, "popup.js"),
    options: path.join(rootDir, "options.js"),
    background: path.join(rootDir, "background.js"),
    content: path.join(rootDir, "content.js"),
  },
  outdir: outDir,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["firefox128"],
  logLevel: "info",
  legalComments: "none",
  sourcemap: false,
};

async function main() {
  await rm(outDir, { recursive: true, force: true });

  if (watchMode) {
    const context = await esbuild.context(buildOptions);
    await context.watch();
    console.log("Watching extension bundles in dist/ ...");
    return;
  }

  await esbuild.build(buildOptions);
  console.log("Built extension bundles to dist/.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
