# codex-tauri

Pass 的 **Win / macOS / Linux** 统一桌面壳（Tauri 2）。  
macOS **系统级**能力（AutoFill、Credential Exchange）仍在 `apps/app_macos`（SwiftUI）；本壳用于跨桌面与 **自建同步互通**，设置面板与快捷键对齐 PassMac 主力功能。

旧 Tauri/Flutter 实验壳已移除；跨平台桌面功能只在本目录继续开发。

## 已实现

### 账号与组织
- 设备名、账号 CRUD、回收站（软删 / 恢复 / 永久墓碑）
- 文件夹、站点规则自动加入、文件夹内去重
- 别名并集、TOTP 展示与粘贴导入

### 设置（⌘, / Ctrl+,）
- **通用**：设备名、字体/字号/提示时长、全局显示密码
- **在服务器创建服务**：SSH 安装/更新远端 `pass-sync-server`（与 PassMac 同能力）；创建前检测旧服务，若存在则弹窗询问是否删除后再创建
- **数据同步**：自建服务器 URL + Bearer、同步密钥/轮换前密钥、自动同步间隔、预览/合并/云端覆盖/本地覆盖、服务器与本地安全快照恢复；WebDAV 配置项（本版先落盘，同步主路径仍为自建）
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
2. 两端配置 **同一 Base URL + Bearer Token**（可选同一同步加密密钥）。
3. macOS：设置里启用自建服务器 → 合并同步。
4. 本应用：⌘, → 数据同步 → 启用 → 保存 →「预览合并」→「合并同步」。
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
- 本地 vault 密钥：`<app_local_data_dir>/pass-local-vault-key-v1`（0600）
- 同步设置、界面偏好、SSH 凭据和本地安全快照：均用本地 AES-256-GCM vault 加密并限制为当前用户可读；旧明文数据首次读取后自动迁移
- 本地安全快照：同步、同步包/浏览器 CSV 导入、服务器恢复及账号/文件夹修改前自动保留，最多 20 个

## 仍属 macOS 专属（未迁入 Tauri）

- 系统 AutoFill / Credential Provider
- Apple Credential Exchange 导出
- 谷歌验证器导出二维码批量图片识别（可用粘贴 TOTP 路径）

## 说明

- 开发测试向；本地 vault 使用逐记录 AES-256-GCM 加密，尚未切换到 SQLCipher。
- 不要把 Token / 同步密钥写进仓库或 CI 日志。
