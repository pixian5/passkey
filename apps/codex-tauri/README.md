# codex-tauri

Pass 的 **Win / macOS / Linux** 统一桌面壳（Tauri 2）。  
macOS **系统级**能力（AutoFill、Credential Exchange）仍在 `apps/app_macos`（SwiftUI）；本壳用于跨桌面与 **自建同步互通**。

> `apps/copilot-53-tauri` 已冻结，请勿继续加功能。

## 已实现

- 设备名、账号 CRUD、回收站（软删 / 恢复 / 永久墓碑）
- 别名并集、CSV 导出（`pass-merge` / `pass-csvio`）
- **自建同步**：`GET/PUT /v2/sync/state`（Bearer、ETag/If-Match、412 重试）
- 合并权威：`pass_merge::v2` + `evaluate_sync_safety`
- 可选 AES-256-GCM 信封（`pass.sync.encrypted.v1`，与 macOS/扩展兼容）
- 同步预览（不写库）与立即同步（写库并推送）
- 本地粘贴 JSON 的合并预览（调试）

## 与 macOS 互相同步

1. 启动自建服务（例：`apps/sync_server_ubuntu` 或本机开发端口）。
2. 两端配置 **同一 Base URL + Bearer Token**（可选同一同步加密密钥）。
3. macOS：设置里启用自建服务器 → 合并同步。
4. 本应用：勾选「启用同步」→ 保存 →「预览合并」→「立即同步」。
5. 合并后账号列表应收敛。

```bash
cd apps/codex-tauri
npm install
npm run tauri dev
```

## 打包

```bash
npm run tauri build
# 产物：src-tauri/target/release/bundle/
```

## 数据

- SQLite：`<app_local_data_dir>/pass-tauri.db`（`accounts.v2` 等）
- 同步设置：`<app_local_data_dir>/sync_settings.json`（Unix 0600）

## 说明

- 开发测试向；本地 vault 尚未做应用锁 / SQLCipher（后续 D3）。
- 不要把 Token / 同步密钥写进仓库或 CI 日志。
