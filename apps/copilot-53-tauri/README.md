# copilot-53-tauri（已冻结）

> **状态：DEPRECATED / 冻结**  
> 请勿再往本目录加产品功能。

## 原因

桌面产品壳统一为 **`apps/codex-tauri`**（Win / macOS / Linux）：

- 已接入共享 Core：`pass-merge`、`pass-csvio`
- 正在补齐与 macOS 互通的自建同步（`/v2/sync/state`）

本目录仅为历史演示骨架，别名/CSV 等存在平行实现，继续开发会导致语义分叉。

## 迁移

```bash
cd apps/codex-tauri
npm install
npm run tauri dev
```

见 `apps/codex-tauri/README.md`。
