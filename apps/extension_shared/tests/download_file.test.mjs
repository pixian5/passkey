import test from "node:test";
import assert from "node:assert/strict";
import { downloadTextFile } from "../download_file.js";

function createDocumentStub() {
  const appended = [];
  const body = {
    appendChild(node) {
      appended.push(node);
    },
  };
  return {
    appended,
    body,
    createElement() {
      return {
        style: {},
        clickCount: 0,
        click() {
          this.clickCount += 1;
        },
        remove() {
          this.removed = true;
        },
      };
    },
  };
}

test("下载会先挂载链接，延迟释放 Blob URL 并清理节点", async () => {
  const documentRef = createDocumentStub();
  const revoked = [];
  const urlRef = {
    createObjectURL(blob) {
      assert.equal(blob.type, "text/plain");
      return "blob:test";
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };

  const promise = downloadTextFile("export.txt", "hello", "text/plain", {
    documentRef,
    urlRef,
    BlobCtor: Blob,
    revokeDelayMs: 5,
  });
  assert.equal(documentRef.appended.length, 1);
  const anchor = documentRef.appended[0];
  assert.equal(anchor.href, "blob:test");
  assert.equal(anchor.download, "export.txt");
  assert.equal(anchor.clickCount, 1);
  assert.deepEqual(revoked, []);

  await promise;
  assert.deepEqual(revoked, ["blob:test"]);
  assert.equal(anchor.removed, true);
});

test("页面尚未加载时导出返回明确错误", async () => {
  await assert.rejects(
    downloadTextFile("export.txt", "hello", "text/plain", {
      documentRef: { body: null },
      urlRef: { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} },
      BlobCtor: Blob,
    }),
    /页面尚未完成加载/
  );
});
