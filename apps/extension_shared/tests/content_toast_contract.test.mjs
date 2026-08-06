import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contentSource = await readFile(new URL("../content.js", import.meta.url), "utf8");

test("网页内 Pass 提示隔离样式并固定在视口右上角", () => {
  assert.match(contentSource, /attachShadow\(\{ mode: "closed" \}\)/);
  assert.match(contentSource, /setAttribute\("popover", "manual"\)/);
  assert.match(contentSource, /host\.showPopover\(\)/);
  assert.match(contentSource, /position: "fixed"/);
  assert.match(contentSource, /inset: "14px 14px auto auto"/);
  assert.match(contentSource, /host\.style\.setProperty\(cssProperty, value, "important"\)/);
  assert.doesNotMatch(contentSource, /600 24px\/1\.4/);
});

test("保存密码使用常驻右上角浮窗并等待用户明确选择", () => {
  assert.doesNotMatch(contentSource, /window\.confirm\(/);
  assert.match(contentSource, /PASS_LOGIN_SAVE_PROMPT_ID/);
  assert.match(contentSource, /showLoginSavePrompt\(payload, mode\)/);
  assert.match(contentSource, /if \(!checkFinished\) resumeOnce\(\)/);
  assert.match(contentSource, /保存并继续/);
  assert.match(contentSource, /暂不保存/);
  assert.match(contentSource, /检测到该账号密码已更改/);
  assert.match(contentSource, /更新已保存的密码/);
  assert.match(contentSource, /更新并继续/);
  assert.match(contentSource, /检测到一个尚未保存的登录账号/);
  assert.match(contentSource, /保存这个账号/);
  assert.match(contentSource, /if \(loginSavePromptHost\) \{\s*event\.preventDefault\(\);\s*return;/);
  assert.doesNotMatch(contentSource, /setTimeout\(resumeOnce, 800\)/);
});
