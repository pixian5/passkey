import assert from "node:assert/strict";
import test from "node:test";

import { pageUiOwnerPriority } from "../page_ui_owner.js";

test("并行加载的新扩展版本始终取得网页 UI 所有权", () => {
  assert.ok(pageUiOwnerPriority("1.4.3") > pageUiOwnerPriority("1.3.7"));
  assert.ok(pageUiOwnerPriority("2.0.0") > pageUiOwnerPriority("1.99.99"));
  assert.equal(pageUiOwnerPriority("1.4.3"), pageUiOwnerPriority("1.4.3"));
  assert.ok(pageUiOwnerPriority("0.0.0") > 10);
});
