/**
 * Start a browser download and keep the Blob URL alive until Chromium has had
 * a chance to consume it. The dependency arguments make this boundary easy to
 * exercise without opening a real browser download in tests.
 */
export function downloadTextFile(
  fileName,
  content,
  mimeType,
  {
    documentRef = globalThis.document,
    urlRef = globalThis.URL,
    BlobCtor = globalThis.Blob,
    revokeDelayMs = 1000,
  } = {}
) {
  return new Promise((resolve, reject) => {
    let url = "";
    let anchor = null;
    try {
      if (!documentRef?.body) throw new Error("导出页面尚未完成加载");
      if (typeof BlobCtor !== "function") throw new Error("当前浏览器不支持文件导出");
      if (typeof urlRef?.createObjectURL !== "function") throw new Error("当前浏览器不支持文件导出");

      const blob = new BlobCtor([content], { type: mimeType });
      url = urlRef.createObjectURL(blob);
      anchor = documentRef.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.style.display = "none";
      documentRef.body.appendChild(anchor);
      anchor.click();

      // Chromium may not start the download until the current task has ended.
      // Revoking the Blob URL synchronously makes the download appear cancelled.
      setTimeout(() => {
        if (url) urlRef.revokeObjectURL(url);
        anchor?.remove();
        resolve();
      }, revokeDelayMs);
    } catch (error) {
      if (url) urlRef.revokeObjectURL(url);
      anchor?.remove();
      reject(error);
    }
  });
}
