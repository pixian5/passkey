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
