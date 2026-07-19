import assert from "node:assert/strict";
import test from "node:test";

import { createSyncIdempotencyKey, secureRandomUuid } from "../secure_random.js";

test("安全 UUID 在没有 randomUUID 时使用 getRandomValues", () => {
  const cryptoApi = {
    getRandomValues(bytes) {
      bytes.fill(0);
      return bytes;
    },
  };
  assert.equal(secureRandomUuid(cryptoApi), "00000000-0000-4000-8000-000000000000");
  assert.equal(createSyncIdempotencyKey(100, cryptoApi), "pass-100-00000000-0000-4000-8000-000000000000");
});

test("没有加密安全随机源时同步幂等键会失败而不是退化", () => {
  assert.throws(() => createSyncIdempotencyKey(100, {}), /不支持安全随机数/);
});
