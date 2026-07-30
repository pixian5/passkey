import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

import { buildSyncOperationReport } from "../sync_report.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const schema = JSON.parse(await readFile(
  path.join(repositoryRoot, "docs/schemas/sync-operation-report-v1.schema.json"),
  "utf8",
));
const validate = new Ajv2020({ strict: true }).compile(schema);

const base = {
  mode: "merge",
  localAccounts: 2,
  remoteAccounts: 3,
  mergedAccounts: 4,
  source: "selfHosted",
  syncSessionId: "session-1",
  operationId: "operation-1",
};

for (const [name, input] of [
  ["成功", { ok: true, safe: true, safety: "passed", message: "同步完成", applied: true, pushed: true, remotePulled: true, stage: "completed" }],
  ["预览", { ok: true, dryRun: true, safe: true, safety: "passed", message: "预览完成", remotePulled: true, stage: "completed" }],
  ["安全阻断", { ok: false, safe: false, safety: "blocked", reasons: ["删除比例过高"], message: "安全检查未通过", remotePulled: true, stage: "safetyChecking" }],
  ["拉取失败", { ok: false, safe: true, safety: "notEvaluated", reasons: ["HTTP 503"], message: "拉取失败", retryable: true, stage: "pullingRemote" }],
  ["本地并发变化", { ok: false, safe: true, safety: "notEvaluated", reasons: ["本地内容已变化"], message: "请重新同步", remotePulled: true, retryable: true, stage: "checkingLocalConcurrency" }],
]) {
  test(`Chrome 同步${name}报告符合统一 Schema`, () => {
    const report = buildSyncOperationReport({ ...base, ...input });
    assert.equal(validate(report), true, JSON.stringify(validate.errors));
    assert.equal(report.reportVersion, 1);
    assert.equal(report.operationId, "operation-1");
  });
}
