import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isSyncOutboxReady,
  removeSyncOutbox,
  syncTargetKey,
  upsertSyncOutbox,
} from "../sync_outbox.js";

async function startRemote({ failFirstPut = false } = {}) {
  let body = "";
  let putCount = 0;
  const server = http.createServer((request, response) => {
    if (request.method === "PUT") {
      putCount += 1;
      if (failFirstPut && putCount === 1) {
        response.writeHead(503).end();
        return;
      }
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        body = Buffer.concat(chunks).toString("utf8");
        response.writeHead(200, { ETag: `"revision-${putCount}"` }).end();
      });
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" }).end(body || "{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/sync.json`,
    get body() { return body; },
    get putCount() { return putCount; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function putPayload(target, payload) {
  const response = await fetch(target.url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

test("一源成功一源失败时，重启后补偿队列继续上传并清空", async () => {
  const primary = await startRemote();
  const mirror = await startRemote({ failFirstPut: true });
  const directory = await mkdtemp(path.join(os.tmpdir(), "pass-sync-outbox-e2e-"));
  const outboxFile = path.join(directory, "outbox.json");
  const payload = { accounts: [{ recordId: "account-1", updatedAtMs: 100 }], folders: [], passkeys: [] };
  const targets = [
    { kind: "server", url: primary.url },
    { kind: "webdav", url: mirror.url },
  ];
  let outbox = [];

  try {
    for (const target of targets) {
      try {
        await putPayload(target, payload);
      } catch (error) {
        outbox = upsertSyncOutbox(outbox, {
          targetKey: syncTargetKey(target), payload, error, nowMs: 1_000,
        });
      }
    }
    assert.deepEqual(JSON.parse(primary.body), payload);
    assert.equal(outbox.length, 1);
    await writeFile(outboxFile, JSON.stringify(outbox), "utf8");

    // Simulate the extension/app process exiting and reading the persisted queue.
    outbox = JSON.parse(await readFile(outboxFile, "utf8"));
    assert.equal(isSyncOutboxReady(outbox[0], 5_999), false);
    assert.equal(isSyncOutboxReady(outbox[0], 6_000), true);
    await putPayload(targets[1], outbox[0].payload);
    outbox = removeSyncOutbox(outbox, outbox[0].targetKey);

    assert.deepEqual(JSON.parse(mirror.body), payload);
    assert.equal(mirror.putCount, 2);
    assert.equal(outbox.length, 0);
  } finally {
    await Promise.all([primary.close(), mirror.close()]);
    await rm(directory, { recursive: true, force: true });
  }
});
