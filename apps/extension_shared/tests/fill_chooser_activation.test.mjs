import test from "node:test";
import assert from "node:assert/strict";

import {
  FILL_CHOOSER_ACTIVATION_DEDUPE_MS,
  claimFillChooserActivation,
} from "../fill_chooser_activation.js";

test("同一次点击产生的 pointer/focus/click 只申请一次账号选择框", () => {
  const state = { input: null, at: 0 };
  const passwordInput = {};
  assert.equal(claimFillChooserActivation(state, passwordInput, 1_000), true);
  assert.equal(claimFillChooserActivation(state, passwordInput, 1_010), false);
  assert.equal(claimFillChooserActivation(state, passwordInput, 1_050), false);
});

test("不同输入框或超过去重窗口后仍可再次主动打开", () => {
  const state = { input: null, at: 0 };
  const usernameInput = {};
  const passwordInput = {};
  assert.equal(claimFillChooserActivation(state, usernameInput, 2_000), true);
  assert.equal(claimFillChooserActivation(state, passwordInput, 2_010), true);
  assert.equal(
    claimFillChooserActivation(state, passwordInput, 2_010 + FILL_CHOOSER_ACTIVATION_DEDUPE_MS),
    true,
  );
});
