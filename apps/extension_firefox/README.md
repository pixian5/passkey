# extension_firefox

Firefox 平台壳层。

## 说明
- 共享代码位于 [`/Users/x/code/pass/apps/extension_shared`](/Users/x/code/pass/apps/extension_shared)
- 当前目录只保留 Firefox 专用 `manifest.json` 与壳层入口
- `popup.*`、`options.*`、`background.js`、`content.js`、`dist/` 都通过符号链接引用共享目录

## 构建
```bash
cd /Users/x/code/pass/apps/extension_firefox
npm run build
```

## 载入
1. 打开 `about:debugging#/runtime/this-firefox`
2. 点击“临时载入附加组件”
3. 选择 [`/Users/x/code/pass/apps/extension_firefox/manifest.json`](/Users/x/code/pass/apps/extension_firefox/manifest.json)
