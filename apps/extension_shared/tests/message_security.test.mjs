import assert from "node:assert/strict";
import test from "node:test";

import { isTrustedExtensionMessageSender } from "../message_security.js";

test("仅当前扩展自身及其内容脚本可调用后台敏感消息", () => {
  const runtimeId = "icalmbmojggobleheemliicoobanadaj";
  assert.equal(isTrustedExtensionMessageSender({ id: runtimeId }, runtimeId), true);
  assert.equal(isTrustedExtensionMessageSender({ id: "other-extension-id" }, runtimeId), false);
  assert.equal(isTrustedExtensionMessageSender({}, runtimeId), false);
  assert.equal(isTrustedExtensionMessageSender({ id: runtimeId }, ""), false);
});
