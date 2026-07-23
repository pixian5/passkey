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

已包含工作区的账号、文件夹、排序、置顶、回收站、批量文件夹归属、撤销/重做、历史、本地快照、CSV/同步包导入导出和同步预览等操作。Chrome 测试插件不提供 Tauri 专属的 SSH 自建服务部署、系统指纹解锁和 WebDAV；这些命令会给出明确提示，桌面端功能不受影响。

同步包和本地数据使用本插件独立的 Chrome Storage 空间。首次加载不会自动读取旧插件数据，请通过同步包或 CSV 导入测试数据。
