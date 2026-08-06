# codex-tauri

Pass 的 **Win / macOS / Linux** 统一桌面壳（Tauri 2）。  
macOS **系统级**能力（AutoFill、Credential Exchange）仍在 `apps/app_macos`（SwiftUI）；本壳用于跨桌面与 **自建同步互通**，设置面板与快捷键对齐 PassMac 主力功能。

“统一桌面壳”不表示与 Docker Web/Chrome 的平台能力完全相同。Tauri 独有 SSH 创建服务和原生文件选择器，Touch ID 仅 macOS 可用；多个应用进程同时写同一数据目录尚无文件级 revision/CAS 保证。

旧 Tauri/Flutter 实验壳已移除；跨平台桌面功能只在本目录继续开发。

当前事实、命令矩阵和跨平台边界以 [`../../docs/current-app-extension-implementation-reference-zh.md`](../../docs/current-app-extension-implementation-reference-zh.md) 为准。

## 已实现

### 账号与组织
- 设备名、账号 CRUD、回收站（软删 / 恢复 / 永久墓碑）
- 文件夹、站点规则自动加入、文件夹内去重
- 别名并集、TOTP 展示与粘贴导入

### 设置（⌘, / Ctrl+,）
- **通用**：设备名、字体/字号/提示时长、全局显示密码
- **在服务器创建服务**：SSH 安装/更新远端 `pass-sync-server`（与 PassMac 同能力）；创建前检测旧服务，若存在则弹窗询问是否删除后再创建
- **数据同步**：自建服务器 URL + Bearer、同步密钥/轮换前密钥、自动同步间隔、预览/合并/云端覆盖/本地覆盖、服务器与本地安全快照恢复；同时支持 WebDAV 同步
- **导入导出**：全部账号 CSV、Chrome/Firefox/Safari CSV 导入导出、同步包导入合并/导出
- **应用锁**：主密码、退出前不锁定 / 空闲超时 / 切到后台锁定、立即锁定；可选优先指纹，macOS 支持 Touch ID 解锁
- **开发**：健康检查、粘贴 JSON 合并预览

### 同步引擎
- `GET/PUT /v2/sync/state`（Bearer、ETag/If-Match、412 重试）
- 合并权威：`pass_merge::v2` + `evaluate_sync_safety`
- 可选 AES-256-GCM 信封（`pass.sync.encrypted.v1`，与 macOS/扩展兼容）

### 快捷键
- **⌘, / Ctrl+,**：打开设置（菜单「Pass → 设置...」与前端快捷键）
- **⌘N / Ctrl+N**：新建账号（焦点不在输入框时）
- **⌘A / Ctrl+A**：全选当前筛选结果中的账号（焦点不在输入框或弹层时）
- **Esc**：关闭弹层

### Toast（提示条）
- **成功 → 绿**、**失败 → 红**、**警告 → 黄**（强制约定，见 [docs/toast-spec-zh.md](docs/toast-spec-zh.md)）
- API：`toastSuccess` / `toastError` / `toastWarn`；兼容 `message(text, level?)` 会自动推断等级
- 时长：设置 → 通用 →「提示时长」

## 与 macOS 互相同步

1. 启动自建服务（例：`apps/sync_server_ubuntu` 或本机开发端口）。
2. 两端配置 **同一 Base URL**；Bearer Token 和同步加密密钥均可留空，使用时两端填写相同值。
3. macOS：设置里启用自建服务器 → 合并同步。
4. 本应用：⌘, → 数据同步 → 启用；设置输入后自动保存，再执行「预览合并」或「合并」。
5. 合并后账号列表应收敛。

```bash
cd apps/codex-tauri
npm install
npm run dev
```

## 打包

```bash
npm run build
# 产物：src-tauri/target/release/bundle/
codesign --verify --deep --strict src-tauri/target/release/bundle/macos/PassDesktop.app
```

macOS 开发包在 `tauri.conf.json` 中使用临时签名身份 `-`，使 `Info.plist`、可执行文件和资源一起封装，避免只有链接器签名但资源未封装。该签名只用于本机开发测试；对外发布仍必须换成 Apple Developer ID 并完成公证。

## 数据

- SQLite：`<app_local_data_dir>/pass-tauri.db`（`accounts.v2` 等）
- 本地 vault 密钥：`<app_local_data_dir>/pass-local-vault-key-v1`（0600）
- 同步设置、界面偏好、SSH 凭据和本地安全快照：均用本地 AES-256-GCM vault 加密并限制为当前用户可读；旧明文数据首次读取后自动迁移
- 本地安全快照：同步、同步包/浏览器 CSV 导入、服务器恢复及账号/文件夹修改前自动保留，最多 20 个

## 仍属 macOS 专属（未迁入 Tauri）

- 系统 AutoFill / Credential Provider
- Apple Credential Exchange 导出
- 谷歌验证器导出二维码批量图片识别（可用粘贴 TOTP 路径）



## 本地写入与历史（1.1.1）

- 账号、文件夹、全部账号顺序同事务写入；同步整体写回使用 `save_payload_atomic`。
- 加密 vault / 操作历史 / app lock 文件：临时文件 + `fsync` + rename + 目录 `fsync`。
- 撤销使用 `latest_distinct_undo`，忽略与当前状态相同的 no-op 历史。
- 主密码不 `trim`。
- SSH 部署远端路径 shell quote；部署后 `/healthz` 使用正常 TLS 校验。
- 详细规则：[`docs/local-write-durability-and-history-consistency-zh.md`](../../docs/local-write-durability-and-history-consistency-zh.md)

## 说明

- 开发测试向；本地 vault 使用逐记录 AES-256-GCM 加密，尚未切换到 SQLCipher。
- 不要把 Token / 同步密钥写进仓库或 CI 日志。
- 修改共享管理 UI 后，Docker Web 和 Chrome Web 扩展也会受影响；提交前至少运行根目录 `bash scripts/test_all.sh` 或按变更范围运行对应分模块测试。
