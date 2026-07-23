# Pass Web 预览扩展

这是独立于旧版 `apps/extension_chrome` 的 Chrome 测试插件。它保留现有扩展的填充、Passkey、同步和本地加密业务脚本，只把“Pass 设置”管理页换成 Web 风格的独立页面，便于与旧插件并行对照。

## 加载

1. 打开 Chrome 的 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本目录：`/Users/x/code/pass/apps/extension_chrome_web`。

旧插件目录 `apps/extension_chrome` 不要卸载，两个插件可以同时加载。

## 数据隔离

Chrome 会按扩展 ID 隔离 `chrome.storage` 和 IndexedDB，因此这个预览插件不会自动读取旧插件数据。测试时请使用同步包、同步服务器或导入导出来准备数据，避免误改旧插件。

## 当前范围

当前版本是第一阶段视觉与交互验证版。管理页仍复用已验证的扩展业务逻辑；后续确认 Web 布局后，再把 Tauri/Web 的完整工作区和统一命令适配层移入本插件。
