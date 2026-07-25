#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionFile = path.join(root, "VERSION");
const semverPattern = /^\d+\.\d+\.\d+$/;

const jsonTargets = [
  "apps/codex-tauri/package.json",
  "apps/codex-tauri/src-tauri/tauri.conf.json",
  "apps/extension_shared/package.json",
  "apps/extension_shared/manifest.json",
  "apps/extension_firefox/package.json",
  "apps/extension_firefox/manifest.json",
  "apps/extension_chrome_web/package.json",
  "apps/extension_chrome_web/manifest.json",
];

const packageLockTargets = [
  "apps/codex-tauri/package-lock.json",
  "apps/extension_shared/package-lock.json",
];

const cargoTargets = [
  ["apps/codex-tauri/src-tauri/Cargo.toml", "apps/codex-tauri/src-tauri/Cargo.lock", "codex-tauri"],
  ["apps/pass-web/Cargo.toml", "apps/pass-web/Cargo.lock", "pass-web"],
];

const marketingYamlTargets = [
  "apps/app_macos/project.yml",
  "apps/app_macos/project.autofill.yml",
];

const marketingProjectTargets = [
  "apps/app_macos/PassMac.xcodeproj/project.pbxproj",
  "apps/extension_safari/PassSafari/PassSafari.xcodeproj/project.pbxproj",
];

const androidGradleTarget = "apps/android_credential_provider/app/build.gradle.kts";

const documentationVersionTargets = [
  ["docs/current-app-extension-implementation-reference-zh.md", /(当前为 `)[^`]+(`)/, "当前实现版本"],
  ["docs/three-surface-unification-zh.md", /(## 8\. 当前对齐结论（版本 )[^）]+(）)/, "三端对齐版本"],
];

function absolute(relativePath) {
  return path.join(root, relativePath);
}

function validateVersion(value, source = "version") {
  const version = String(value || "").trim();
  if (!semverPattern.test(version)) {
    throw new Error(`${source} 必须是 major.minor.patch，实际为 ${JSON.stringify(value)}`);
  }
  const [, minor, patch] = version.split(".").map(Number);
  if (minor > 9 || patch > 9) {
    throw new Error(`${source} 的 minor 和 patch 必须在 0..9，满十必须进位，实际为 ${version}`);
  }
  return version;
}

function readCanonicalVersion() {
  return validateVersion(fs.readFileSync(versionFile, "utf8"), "VERSION");
}

function nextVersion(version) {
  let [major, minor, patch] = validateVersion(version).split(".").map(Number);
  patch += 1;
  if (patch >= 10) {
    patch = 0;
    minor += 1;
  }
  if (minor >= 10) {
    minor = 0;
    major += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function platformBuildNumber(version) {
  const [major, minor, patch] = validateVersion(version).split(".").map(Number);
  const buildNumber = major * 100 + minor * 10 + patch;
  if (buildNumber > 2_147_483_647) {
    throw new Error(`版本 ${version} 超出平台构建号可表示范围`);
  }
  return buildNumber;
}

function writeText(relativePath, content) {
  const file = absolute(relativePath);
  const current = fs.readFileSync(file, "utf8");
  if (current !== content) fs.writeFileSync(file, content, "utf8");
}

function updateJson(relativePath, version) {
  const data = JSON.parse(fs.readFileSync(absolute(relativePath), "utf8"));
  data.version = version;
  writeText(relativePath, `${JSON.stringify(data, null, 2)}\n`);
}

function updatePackageLock(relativePath, version) {
  const data = JSON.parse(fs.readFileSync(absolute(relativePath), "utf8"));
  data.version = version;
  if (!data.packages?.[""]) throw new Error(`${relativePath} 缺少 packages[\"\"]`);
  data.packages[""].version = version;
  writeText(relativePath, `${JSON.stringify(data, null, 2)}\n`);
}

function replaceExactly(relativePath, pattern, replacement, description) {
  const current = fs.readFileSync(absolute(relativePath), "utf8");
  const matches = [...current.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  if (!matches.length) throw new Error(`${relativePath} 找不到 ${description}`);
  writeText(relativePath, current.replace(pattern, replacement));
}

function updateCargoToml(relativePath, version) {
  replaceExactly(
    relativePath,
    /(\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m,
    `$1${version}$2`,
    "[package] version",
  );
}

function updateCargoLock(relativePath, packageName, version) {
  const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  replaceExactly(
    relativePath,
    new RegExp(`(\\[\\[package\\]\\]\\nname = "${escapedName}"\\nversion = ")[^"]+("\\n)`),
    `$1${version}$2`,
    `${packageName} lock version`,
  );
}

function setVersion(version) {
  version = validateVersion(version);
  fs.writeFileSync(versionFile, `${version}\n`, "utf8");
  for (const target of jsonTargets) updateJson(target, version);
  for (const target of packageLockTargets) updatePackageLock(target, version);
  for (const [toml, lock, packageName] of cargoTargets) {
    updateCargoToml(toml, version);
    updateCargoLock(lock, packageName, version);
  }
  for (const target of marketingYamlTargets) {
    replaceExactly(target, /(MARKETING_VERSION:\s*")[^"]+("\s*$)/gm, `$1${version}$2`, "MARKETING_VERSION");
    replaceExactly(
      target,
      /(CURRENT_PROJECT_VERSION:\s*")[^"]+("\s*$)/gm,
      `$1${platformBuildNumber(version)}$2`,
      "CURRENT_PROJECT_VERSION",
    );
  }
  for (const target of marketingProjectTargets) {
    replaceExactly(target, /(MARKETING_VERSION\s*=\s*)[^;]+(;)/g, `$1${version}$2`, "MARKETING_VERSION");
    replaceExactly(
      target,
      /(CURRENT_PROJECT_VERSION\s*=\s*)[^;]+(;)/g,
      `$1${platformBuildNumber(version)}$2`,
      "CURRENT_PROJECT_VERSION",
    );
  }
  replaceExactly(
    androidGradleTarget,
    /(versionCode\s*=\s*)\d+/,
    `$1${platformBuildNumber(version)}`,
    "Android versionCode",
  );
  replaceExactly(
    androidGradleTarget,
    /(versionName\s*=\s*")[^"]+("\s*$)/m,
    `$1${version}$2`,
    "Android versionName",
  );
  replaceExactly(
    "apps/app_macos/AutofillExtension/AutoFillExtension-Info.plist",
    /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+(<\/string>)/,
    `$1${version}$2`,
    "CFBundleShortVersionString",
  );
  replaceExactly(
    "apps/app_macos/AutofillExtension/AutoFillExtension-Info.plist",
    /(<key>CFBundleVersion<\/key>\s*<string>)[^<]+(<\/string>)/,
    `$1${platformBuildNumber(version)}$2`,
    "CFBundleVersion",
  );
  replaceExactly(
    "apps/extension_shared/extension_version.js",
    /(PASS_EXTENSION_VERSION\s*=\s*)["'][^"']+["']/,
    `$1${JSON.stringify(version)}`,
    "PASS_EXTENSION_VERSION",
  );
  for (const [target, pattern, description] of documentationVersionTargets) {
    replaceExactly(target, pattern, `$1${version}$2`, description);
  }
}

function collectVersions() {
  const entries = [];
  for (const target of jsonTargets) {
    const data = JSON.parse(fs.readFileSync(absolute(target), "utf8"));
    entries.push([`${target}:version`, data.version]);
  }
  for (const target of packageLockTargets) {
    const data = JSON.parse(fs.readFileSync(absolute(target), "utf8"));
    entries.push([`${target}:version`, data.version]);
    entries.push([`${target}:packages.root.version`, data.packages?.[""]?.version]);
  }
  for (const [toml, lock, packageName] of cargoTargets) {
    const tomlText = fs.readFileSync(absolute(toml), "utf8");
    entries.push([toml, tomlText.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1]]);
    const lockText = fs.readFileSync(absolute(lock), "utf8");
    const escapedName = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    entries.push([lock, lockText.match(new RegExp(`\\[\\[package\\]\\]\\nname = "${escapedName}"\\nversion = "([^"]+)"`))?.[1]]);
  }
  for (const target of marketingYamlTargets) {
    const values = [...fs.readFileSync(absolute(target), "utf8").matchAll(/MARKETING_VERSION:\s*"([^"]+)"/g)];
    values.forEach((match, index) => entries.push([`${target}:MARKETING_VERSION[${index}]`, match[1]]));
    const buildValues = [...fs.readFileSync(absolute(target), "utf8").matchAll(/CURRENT_PROJECT_VERSION:\s*"([^"]+)"/g)];
    buildValues.forEach((match, index) => entries.push([`${target}:buildNumber[${index}]`, Number(match[1])]));
  }
  for (const target of marketingProjectTargets) {
    const values = [...fs.readFileSync(absolute(target), "utf8").matchAll(/MARKETING_VERSION\s*=\s*([^;]+);/g)];
    values.forEach((match, index) => entries.push([`${target}:MARKETING_VERSION[${index}]`, match[1].trim()]));
    const buildValues = [...fs.readFileSync(absolute(target), "utf8").matchAll(/CURRENT_PROJECT_VERSION\s*=\s*([^;]+);/g)];
    buildValues.forEach((match, index) => entries.push([`${target}:buildNumber[${index}]`, Number(match[1].trim())]));
  }
  const androidGradle = fs.readFileSync(absolute(androidGradleTarget), "utf8");
  entries.push([`${androidGradleTarget}:versionName`, androidGradle.match(/versionName\s*=\s*"([^"]+)"/)?.[1]]);
  entries.push([`${androidGradleTarget}:versionCode`, Number(androidGradle.match(/versionCode\s*=\s*(\d+)/)?.[1])]);
  const plist = fs.readFileSync(absolute("apps/app_macos/AutofillExtension/AutoFillExtension-Info.plist"), "utf8");
  entries.push([
    "apps/app_macos/AutofillExtension/AutoFillExtension-Info.plist:CFBundleShortVersionString",
    plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1],
  ]);
  entries.push([
    "apps/app_macos/AutofillExtension/AutoFillExtension-Info.plist:buildNumber",
    Number(plist.match(/<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/)?.[1]),
  ]);
  const extensionVersion = fs.readFileSync(absolute("apps/extension_shared/extension_version.js"), "utf8");
  entries.push(["apps/extension_shared/extension_version.js", extensionVersion.match(/PASS_EXTENSION_VERSION\s*=\s*["']([^"']+)["']/)?.[1]]);
  for (const [target, pattern, description] of documentationVersionTargets) {
    entries.push([`${target}:${description}`, fs.readFileSync(absolute(target), "utf8").match(pattern)?.[0].match(/\d+\.\d+\.\d+/)?.[0]]);
  }
  return entries;
}

function checkVersions() {
  const expected = readCanonicalVersion();
  const expectedBuildNumber = platformBuildNumber(expected);
  const mismatches = collectVersions().filter(([source, value]) =>
    source === `${androidGradleTarget}:versionCode` || source.includes(":buildNumber")
      ? value !== expectedBuildNumber
      : value !== expected,
  );
  if (mismatches.length) {
    for (const [source, value] of mismatches) console.error(`${source}: ${value ?? "<missing>"}，期望 ${expected}`);
    process.exitCode = 1;
    return;
  }
  console.log(`VERSION_CHECK_OK ${expected} (${collectVersions().length} entries)`);
}

const [command = "current", argument] = process.argv.slice(2);
switch (command) {
  case "current":
    console.log(readCanonicalVersion());
    break;
  case "next":
    console.log(nextVersion(argument || readCanonicalVersion()));
    break;
  case "check":
    checkVersions();
    break;
  case "set": {
    const version = validateVersion(argument, "set version");
    setVersion(version);
    checkVersions();
    break;
  }
  case "bump": {
    const previous = readCanonicalVersion();
    const version = nextVersion(previous);
    setVersion(version);
    console.log(`VERSION_BUMP_OK ${previous} -> ${version}`);
    checkVersions();
    break;
  }
  default:
    throw new Error(`未知命令 ${command}；可用命令：current、next、check、set、bump`);
}
