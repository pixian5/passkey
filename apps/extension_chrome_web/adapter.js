/**
 * 统一多端通信适配器 (Unified RPC Adapter)
 *
 * 封装并抹平三端调用切面：
 * 1) Chrome 扩展上下文 (window.__PASS_EXTENSION_INVOKE__)
 * 2) Tauri 桌面上下文 (window.__TAURI__.core.invoke 或 window.__TAURI_INTERNALS__.invoke)
 * 3) Pass Web 浏览器上下文 (/api/invoke/:command HTTP RPC + Token 鉴权 + Blob 下载)
 */

export const detectSurface = () => {
  if (typeof window !== "undefined" && typeof window.__PASS_EXTENSION_INVOKE__ === "function") {
    return "chrome-extension";
  }
  const runtime = typeof window !== "undefined" ? (window.__TAURI__?.core ?? window.__TAURI_INTERNALS__) : null;
  if (typeof runtime?.invoke === "function") {
    return "tauri";
  }
  return "docker-web";
};

export const triggerBlobDownload = (base64Data, mimeType, filename) => {
  if (typeof document === "undefined") return;
  try {
    const binary = atob(base64Data);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const blob = new Blob([bytes], {
      type: mimeType || "application/octet-stream",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename || "pass-download";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (error) {
    console.warn("Web download response could not be materialized", error);
  }
};

export class PassClientAdapter {
  constructor() {
    this.surface = detectSurface();
  }

  async invoke(command, args = {}) {
    if (typeof window !== "undefined" && typeof window.__PASS_EXTENSION_INVOKE__ === "function") {
      return window.__PASS_EXTENSION_INVOKE__(command, args);
    }
    const runtime = typeof window !== "undefined" ? (window.__TAURI__?.core ?? window.__TAURI_INTERNALS__) : null;
    if (typeof runtime?.invoke === "function") {
      return runtime.invoke(command, args);
    }
    return this.invokeWeb(command, args, true);
  }

  async invokeWeb(command, args, retryAuth) {
    const token = typeof window !== "undefined" ? (window.localStorage?.getItem("pass.web.authToken") || "") : "";
    const response = await fetch(`/api/invoke/${encodeURIComponent(command)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(args || {}),
    });
    let body = null;
    try {
      body = await response.json();
    } catch (_) {
      body = null;
    }
    if (response.status === 401 && retryAuth && !token && typeof window !== "undefined" && typeof window.prompt === "function") {
      const entered = window.prompt("请输入 Pass Web 访问令牌");
      if (entered?.trim()) {
        window.localStorage?.setItem("pass.web.authToken", entered.trim());
        return this.invokeWeb(command, args, false);
      }
    }
    if (!response.ok) {
      throw new Error(body?.error || `Web API 请求失败（HTTP ${response.status}）`);
    }
    const result = body?.result;
    if (result?.downloadBase64) {
      triggerBlobDownload(result.downloadBase64, result.downloadMime, result.downloadName);
    }
    return result;
  }
}

export const defaultAdapter = new PassClientAdapter();
