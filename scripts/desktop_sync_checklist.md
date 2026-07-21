# 桌面同步检查清单（macOS ↔ Tauri）

## 准备

1. 启动自建服务（Token 自配，勿提交 git）：

```bash
cd apps/sync_server_ubuntu
export PASS_SYNC_HOST=127.0.0.1
export PASS_SYNC_PORT=53334
export PASS_SYNC_BEARER_TOKENS=your-token
export PASS_SYNC_ALLOW_PLAINTEXT=1
python3 pass_sync_server.py
```

2. 两端配置 **相同** Base URL + Bearer Token（可选相同同步加密密钥）。

## macOS → Tauri

1. macOS PassMac：设置 → 启用自建服务器 → 合并同步（或新建账号后同步）。
2. Tauri：`npm run tauri dev` → 启用同步 → 保存 → **预览合并** → 看账号数量。
3. **立即同步** → 账号列表出现 macOS 侧账号。

## Tauri → macOS

1. Tauri 新建唯一用户名账号 → 立即同步。
2. macOS 预览合并 / 合并 → 列表出现该账号。

## 安全闸门

- 本地有数据、远端空：`remoteOverwriteLocal` 应被 safety 拦住（或预览提示 reasons）。
- 配置同步密钥后，明文包应被拒绝。

## 应用锁（Tauri）

1. 启用应用锁 → 锁定 → vault 与 Token 不可见。
2. 解锁后同步设置可再读出（密钥从 `sync_secrets.enc` 解封）。

## 自动化冒烟（管道层）

见开发时使用的 harness 思路：对 `/v2/sync/state` pull/merge/push，不依赖 GUI。
