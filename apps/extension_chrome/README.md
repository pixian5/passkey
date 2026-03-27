# extension_chrome

Chrome 平台壳层。

## 说明
- 共享代码位于 [`/Users/x/code/pass/apps/extension_shared`](/Users/x/code/pass/apps/extension_shared)
- 当前目录只保留 Chrome 专用 `manifest.json`、壳层 `package.json` 与说明文件
- `popup.*`、`options.*`、`background.js`、`content.js`、`dist/`、`scripts/` 都通过符号链接引用共享目录

## 构建
```bash
cd /Users/x/code/pass/apps/extension_chrome
npm run build
```

或在仓库根目录执行：
```bash
/Users/x/code/pass/scripts/build-extension-chrome.sh
```

## 载入
1. 打开 `chrome://extensions`
2. 开启开发者模式
3. 点击“加载已解压的扩展程序”
4. 选择 [`/Users/x/code/pass/apps/extension_chrome`](/Users/x/code/pass/apps/extension_chrome)
