# Pass Web 预览扩展

这是独立于旧版 `apps/extension_chrome` 的 Chrome 测试插件。管理页直接复用 `apps/codex-tauri` 的 Pass Web/Tauri 工作区结构：顶部操作栏、左侧分类与文件夹、搜索、账号列表、回收站、撤销/重做、设置和同步入口。Chrome 环境通过 `extension-bridge.js` 提供本地命令适配，旧插件源码和数据完全隔离。

## 加载

1. 打开 Chrome 的 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本目录：`/Users/x/code/pass/apps/extension_chrome_web`。

旧插件目录 `apps/extension_chrome` 不要卸载，两个插件可以同时加载。

## 数据隔离

Chrome 会按扩展 ID 隔离 `chrome.storage` 和 IndexedDB，因此这个预览插件不会自动读取旧插件数据。测试时请使用同步包、同步服务器或导入导出来准备数据，避免误改旧插件。

## 当前范围

管理页与 Tauri / Docker Web **共用同一套 UI 源码**。构建时由 `apps/codex-tauri/scripts/sync-web-ui.mjs` 生成：

- `web-main.js`
- `web-options.css`
- `web-options.html`

请不要手改上述生成文件。

已包含：账号、文件夹、排序、置顶、回收站、批量文件夹归属、文件夹去重、撤销/重做、历史、本地快照、CSV/同步包导入导出、自建服务器同步预览与合并。

平台边界：

- 不提供系统指纹解锁。
- 不提供 SSH“创建服务”（可保存草稿，实际部署请用桌面端）。
- 暂不提供 WebDAV 与服务器版本恢复；设置页会按 `health_check.capabilities` 降级。
- 浏览器自动填充/弹窗选择账号是扩展独有能力，不要求与完整管理页像素一致。

同步包和本地数据使用本插件独立的 Chrome Storage 空间。首次加载不会自动读取旧插件数据，请通过同步包或 CSV 导入测试数据。
