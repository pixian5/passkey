import test from "node:test";
import assert from "node:assert/strict";

import {
  clampFloatingPosition,
  shouldStartFloatingDrag,
} from "../floating_drag.js";

test("拖动浮层时始终保留在可视区域内", () => {
  assert.deepEqual(
    clampFloatingPosition({
      left: -120,
      top: 900,
      width: 360,
      height: 240,
      viewportWidth: 1280,
      viewportHeight: 800,
    }),
    { left: 8, top: 552 },
  );
});

test("浮层大于可视区域时固定到安全边距", () => {
  assert.deepEqual(
    clampFloatingPosition({
      left: 100,
      top: 100,
      width: 500,
      height: 500,
      viewportWidth: 320,
      viewportHeight: 240,
    }),
    { left: 8, top: 8 },
  );
});

test("只允许主指针从标题或外层留白开始拖动", () => {
  const base = {
    button: 0,
    isPrimary: true,
    targetIsSurface: false,
    targetHasHandle: true,
    targetIsInteractive: false,
  };
  assert.equal(shouldStartFloatingDrag(base), true);
  assert.equal(shouldStartFloatingDrag({ ...base, targetHasHandle: false }), false);
  assert.equal(shouldStartFloatingDrag({ ...base, targetIsInteractive: true }), false);
  assert.equal(shouldStartFloatingDrag({ ...base, button: 2 }), false);
});
