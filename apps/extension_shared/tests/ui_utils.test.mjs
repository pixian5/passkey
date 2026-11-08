import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  inferToastLevel,
  commandMessage,
  isApplePlatform,
  isMultiSelectModifier,
  compareOptionalOrder,
  formatTimeMs,
  formatTime,
  readFileAsText,
  formatUndoRedoTooltip,
  formatOperationHistoryRow,
  formatLockStatusText,
  formatOtpDigitsHtml,
  formatAccountRowHtml,
  resolveKeyboardAction,
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

test("formatTimeMs and formatTime format timestamps with graceful fallbacks", () => {
  assert.equal(formatTimeMs(0), "-");
  assert.equal(formatTimeMs(null), "-");
  assert.equal(formatTimeMs(undefined, "none"), "none");

  // Fixed timestamp: 2026-01-15T12:00:00Z (timestamp: 1768478400000)
  const ts = 1768478400000;
  const formattedMs = formatTimeMs(ts);
  assert.match(formattedMs, /26-\d{1,2}-\d{1,2}/);

  const formattedLocale = formatTime(ts);
  assert.notEqual(formattedLocale, "-");
  assert.equal(formatTime(0), "-");
  assert.equal(formatTime("invalid"), "-");
});

test("readFileAsText handles empty, string, and object payloads safely", async () => {
  assert.equal(await readFileAsText(null), "");
  assert.equal(await readFileAsText("hello world"), "hello world");
  assert.equal(await readFileAsText({ text: async () => "blob content" }), "blob content");
});

test("formatUndoRedoTooltip generates contextual hints or empty defaults", () => {
  assert.equal(formatUndoRedoTooltip(null, "undo"), "当前没有可撤销的本地操作");
  assert.equal(formatUndoRedoTooltip(null, "redo"), "当前没有可重做的本地操作");
  assert.equal(formatUndoRedoTooltip({ title: "删除账号前自动备份" }, "undo"), "删除账号");
  assert.equal(formatUndoRedoTooltip({ title: "修改备注" }, "undo"), "修改备注");
  assert.equal(formatUndoRedoTooltip({}, "redo"), "待重做的本地操作");
});

test("formatOperationHistoryRow renders safe HTML row for undo/redo stacks", () => {
  const dummyFormatTime = (ms) => "2026-01-01 12:00:00";
  const undoHtml = formatOperationHistoryRow(
    { title: "新增账号 <test>", stack: "undo", createdAtMs: 12345 },
    dummyFormatTime
  );
  assert.ok(undoHtml.includes("&lt;test&gt;"));
  assert.ok(undoHtml.includes("可撤销"));
  assert.ok(undoHtml.includes("2026-01-01 12:00:00"));

  const redoHtml = formatOperationHistoryRow(
    { title: "重命名文件夹", stack: "redo", createdAtMs: 12345 },
    dummyFormatTime
  );
  assert.ok(redoHtml.includes("可重做"));
});

test("formatLockStatusText renders policies and biometric hints accurately", () => {
  assert.equal(formatLockStatusText({ enabled: false }), "状态：未启用");
  assert.equal(formatLockStatusText(null), "状态：未启用");

  const unlockedIdle = formatLockStatusText(
    { enabled: true, locked: false, lockPolicy: "idleTimeout", idleLockMinutes: 10 },
    { canBiometric: true }
  );
  assert.equal(unlockedIdle, "状态：已启用；已解锁；空闲 10 分钟锁定；可用指纹");

  const lockedTouch = formatLockStatusText(
    { enabled: true, locked: true, lockPolicy: "onBackground" },
    { biometricAvailable: true, canBiometric: false }
  );
  assert.equal(lockedTouch, "状态：已启用；已锁定；切到后台锁定");
});

test("formatOtpDigitsHtml formats digits with space separation and countdown remain", () => {
  const html = formatOtpDigitsHtml("123456", 28);
  assert.equal(html, '验证码: <span class="otp-digits">123 456</span> <span class="otp-remain">(剩余 28s)</span>');

  const fallback = formatOtpDigitsHtml("", 15);
  assert.equal(fallback, '验证码: <span class="otp-digits">------</span> <span class="otp-remain">(剩余 15s)</span>');
});

test("formatAccountRowHtml renders titles, tags, passkeys, and OTP bindings safely", () => {
  const htmlPinned = formatAccountRowHtml(
    {
      username: "alice",
      sites: ["github.com", "api.github.com"],
      totpSecret: "JBSWY3DPEHPK3PXP",
    },
    { isPinned: true, passkeys: [{ rpId: "github.com", userName: "alice" }] }
  );
  assert.ok(htmlPinned.includes('<span class="pinned-tag" title="置顶">置顶</span>'));
  assert.ok(htmlPinned.includes("用户名: alice"));
  assert.ok(htmlPinned.includes("站点别名: github.com  api.github.com"));
  assert.ok(htmlPinned.includes("通行密钥 RP ID: github.com 用户名: alice"));
  assert.ok(htmlPinned.includes('data-totp="JBSWY3DPEHPK3PXP"'));

  const htmlDeleted = formatAccountRowHtml(
    { username: "bob", isDeleted: true },
    { isRecycleFilter: false }
  );
  assert.ok(htmlDeleted.includes('<span class="deleted-tag">已删除</span>'));

  const htmlInRecycle = formatAccountRowHtml(
    { username: "bob", isDeleted: true },
    { isRecycleFilter: true }
  );
  assert.equal(htmlInRecycle.includes("deleted-tag"), false);
});

test("resolveKeyboardAction identifies shortcut commands accurately across platforms", () => {
  // Select all (Mac: metaKey)
  assert.equal(
    resolveKeyboardAction({ key: "a", metaKey: true, ctrlKey: false }, { isApple: true }),
    "selectAll"
  );
  // Select all blocked when typing in text input
  assert.equal(
    resolveKeyboardAction({ key: "a", metaKey: true, ctrlKey: false }, { isApple: true, isTextInput: true }),
    null
  );
  // Select all blocked when modal is open
  assert.equal(
    resolveKeyboardAction({ key: "a", metaKey: true, ctrlKey: false }, { isApple: true, hasOpenModal: true }),
    null
  );

  // Settings: ⌘, or Ctrl+,
  assert.equal(
    resolveKeyboardAction({ key: ",", metaKey: true, ctrlKey: false }, { isApple: true }),
    "openSettings"
  );
  assert.equal(
    resolveKeyboardAction({ code: "Comma", metaKey: false, ctrlKey: true }, { isApple: false }),
    "openSettings"
  );

  // New account: ⌘N / Ctrl+N
  assert.equal(
    resolveKeyboardAction({ key: "n", metaKey: true, ctrlKey: false }, { isApple: true }),
    "newAccount"
  );
  assert.equal(
    resolveKeyboardAction({ key: "n", metaKey: true, shiftKey: true }, { isApple: true }),
    null
  );

  // Escape
  assert.equal(resolveKeyboardAction({ key: "Escape" }), "escape");
  assert.equal(resolveKeyboardAction({ key: "Tab" }), null);
});
