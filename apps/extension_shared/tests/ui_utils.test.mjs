import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  inferToastLevel,
  commandMessage,
  isApplePlatform,
  isMultiSelectModifier,
  compareOptionalOrder,
} from "../../codex-tauri/src/ui_utils.js";

test("escapeHtml escapes HTML special characters properly", () => {
  assert.equal(
    escapeHtml('<script>alert("hello & welcome")</script>'),
    "&lt;script&gt;alert(&quot;hello &amp; welcome&quot;)&lt;/script&gt;"
  );
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml("plain-text"), "plain-text");
});

test("inferToastLevel detects error, warn, and success messages", () => {
  assert.equal(inferToastLevel("密码错误，请重试"), "error");
  assert.equal(inferToastLevel("网络请求异常 HTTP 500"), "error");
  assert.equal(inferToastLevel("远端版本冲突 412"), "error");
  assert.equal(inferToastLevel("未配置同步服务器"), "error");

  assert.equal(inferToastLevel("请先选择账号"), "warn");
  assert.equal(inferToastLevel("已取消操作"), "warn");
  assert.equal(inferToastLevel("跳过未变更条目"), "warn");
  assert.equal(inferToastLevel("暂无历史记录"), "warn");

  assert.equal(inferToastLevel("已保存并同步完毕"), "success");
  assert.equal(inferToastLevel(""), "success");
});

test("commandMessage handles strings, objects, and fallbacks", () => {
  assert.equal(commandMessage("已更新"), "已更新");
  assert.equal(commandMessage({ message: "已合并" }), "已合并");
  assert.equal(commandMessage(null, "默认提示"), "默认提示");
  assert.equal(commandMessage("", "空提示"), "空提示");
});

test("isApplePlatform detects Apple devices correctly", () => {
  assert.equal(isApplePlatform({ platform: "MacIntel", userAgent: "Macintosh" }), true);
  assert.equal(isApplePlatform({ platform: "iPhone", userAgent: "Mobile" }), true);
  assert.equal(isApplePlatform({ platform: "Win32", userAgent: "Windows NT 10.0" }), false);
  assert.equal(isApplePlatform({ platform: "Linux x86_64", userAgent: "Ubuntu" }), false);
});

test("isMultiSelectModifier branches by Apple platform", () => {
  // On Apple: metaKey is required, ctrlKey must NOT be set
  assert.equal(isMultiSelectModifier({ metaKey: true, ctrlKey: false }, true), true);
  assert.equal(isMultiSelectModifier({ metaKey: false, ctrlKey: true }, true), false); // Ctrl on Mac reserved for context menu

  // On non-Apple: either metaKey or ctrlKey works
  assert.equal(isMultiSelectModifier({ metaKey: false, ctrlKey: true }, false), true);
  assert.equal(isMultiSelectModifier({ metaKey: true, ctrlKey: false }, false), true);
  assert.equal(isMultiSelectModifier({ metaKey: false, ctrlKey: false }, false), false);
});

test("compareOptionalOrder sorts defined before undefined", () => {
  assert.equal(compareOptionalOrder(1, 2) < 0, true);
  assert.equal(compareOptionalOrder(2, 1) > 0, true);
  assert.equal(compareOptionalOrder(1, 1), 0);
  assert.equal(compareOptionalOrder(0, null) < 0, true);
  assert.equal(compareOptionalOrder(null, 0) > 0, true);
  assert.equal(compareOptionalOrder(null, null), 0);
});
