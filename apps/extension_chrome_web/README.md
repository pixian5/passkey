# Pass Chrome 扩展

这是当前正式 Chrome 扩展。管理页直接复用 `apps/codex-tauri` 的 Pass Web/Tauri 工作区结构：顶部操作栏、左侧分类与文件夹、搜索、账号列表、回收站、撤销/重做、设置和同步入口。Chrome 环境通过 `extension-bridge.js` 提供本地命令适配，并复用 `extension_shared` 的填充、popup 和 WebAuthn 构建产物。

## 加载

1. 打开 Chrome 的 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本目录：`/Users/x/code/pass/apps/extension_chrome_web`。

## 数据隔离

旧 Chrome 壳已从仓库移除。若浏览器中仍装有旧扩展，Chrome 会按扩展 ID 隔离 `chrome.storage` 和 IndexedDB；请通过同步包、同步服务器或 CSV 迁移数据。

## 当前范围

管理页与 Tauri / Docker Web **共用同一套 UI 源码**。构建时由 `apps/codex-tauri/scripts/sync-web-ui.mjs` 生成：

- `web-main.js`
- `web-options.css`
- `web-options.html`

请不要手改上述生成文件。

已接入主流程：账号、文件夹、排序、置顶、回收站、批量文件夹归属、文件夹去重、撤销/重做、历史、本地快照、CSV/同步包导入导出、自建服务器同步预览与合并。这里不表示桌面专属能力也可用。

平台边界：

- 不提供系统指纹解锁。
- 不提供 SSH“创建服务”（可保存草稿，实际部署请用桌面端）。
- 不提供 WebDAV；设置页会按 `health_check.capabilities` 明确降级。
- 自建服务器版本列表与恢复已实现，使用 `/v2/sync/versions`。
- 浏览器自动填充/弹窗选择账号是扩展独有能力，不要求与完整管理页像素一致。

加密管理工作区与设置保存在本扩展独立的 `chrome.storage.local`；账号、文件夹、Passkey 和布局顺序还会在同一事务中镜像到后台 IndexedDB，供 popup、填充和 WebAuthn 使用。管理页与后台目前各有锁运行时，依靠消息同步数据，但锁状态机尚未完全合一。

首次加载不会自动读取其它扩展 ID 的 Chrome Storage 或 IndexedDB，请通过同步包、同步服务器或 CSV 导入。68 个 UI 命令都有 bridge 入口不等于所有平台能力都支持，具体以 `health_check.capabilities` 和主实现基准为准。
