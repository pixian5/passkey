# Pass Chrome 扩展

这是当前正式 Chrome 扩展。管理页直接复用 `apps/codex-tauri` 的 Pass Web/Tauri 工作区结构：顶部操作栏、左侧分类与文件夹、搜索、账号列表、回收站、撤销/重做、设置和同步入口。Chrome 环境通过 `extension-bridge.js` 提供本地命令适配，并复用 `extension_shared` 的填充、popup、网页内浮窗和 WebAuthn 构建产物。

当前事实和网页内浮窗交互见：

- [`../../docs/current-app-extension-implementation-reference-zh.md`](../../docs/current-app-extension-implementation-reference-zh.md)
- [`../../docs/browser-extension-in-page-prompts-zh.md`](../../docs/browser-extension-in-page-prompts-zh.md)

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
- 支持 WebDAV，但由后台 Service Worker 统一调度；管理页只写设置和发起同步意图。
- 自建服务器版本列表与恢复已实现，使用 `/v2/sync/versions`。
- 浏览器自动填充、账号选择、保存/更新确认浮窗和 WebAuthn 注入是扩展独有能力，不要求与完整管理页像素一致。

加密管理工作区与设置保存在本扩展独立的 `chrome.storage.local`；账号、文件夹、Passkey 和布局顺序还会在同一事务中镜像到后台 IndexedDB，供 popup、填充和 WebAuthn 使用。管理页与后台目前各有锁运行时，依靠消息同步数据，但锁状态机尚未完全合一。

首次加载不会自动读取其它扩展 ID 的 Chrome Storage 或 IndexedDB，请通过同步包、同步服务器或 CSV 导入。72 个 UI 命令都有 bridge 入口不等于所有平台能力都支持，具体以 `health_check.capabilities` 和主实现基准为准。

## 网页内浮窗

- 账号选择框和保存/更新确认框使用 closed Shadow DOM + manual Popover，默认显示在视口右上角。
- 标题和外层空白区域可拖动，账号按钮、确认按钮和滚动列表不会触发拖动。
- 登录提交时，后台先判断是否已有相同账号：密码变更显示“更新已保存的密码？”，新账号显示“保存这个账号？”。
- 保存/更新确认不使用 `window.confirm`，用户不点击“保存/更新并继续”或“暂不保存”时不会自动消失。

## 构建刷新

```bash
cd /Users/x/code/pass/apps/extension_shared
npm test
npm run build
cd /Users/x/code/pass
./scripts/build-extension-chrome-web.sh
node scripts/version.mjs check
```

正式扩展加载的是 `apps/extension_chrome_web/dist/` 中已跟踪的生成产物；不要只更新 `apps/extension_shared/dist/`。
