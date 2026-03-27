# extension_shared

Pass 浏览器扩展共享核心。

## 目录职责
- 这里存放 Chrome / Firefox / Safari 三个平台共用的前端代码与构建脚本
- 平台差异留在各自壳层目录中：
  - Chrome: [`/Users/x/code/pass/apps/extension_chrome`](/Users/x/code/pass/apps/extension_chrome)
  - Firefox: [`/Users/x/code/pass/apps/extension_firefox`](/Users/x/code/pass/apps/extension_firefox)
  - Safari: [`/Users/x/code/pass/apps/extension_safari`](/Users/x/code/pass/apps/extension_safari)
- 当前共享内容包括：
  - `popup.*`
  - `options.*`
  - `background.js`
  - `content.js`
  - `account_core.js`
  - `data_store.js`
  - `passkey_store.js`
  - `webauthn_injected.js`
  - `scripts/build.mjs`
  - `dist/`

## 构建
```bash
cd /Users/x/code/pass/apps/extension_shared
npm install
npm run build
```

## 一键构建
仓库根目录提供三个一键命令：
```bash
/Users/x/code/pass/scripts/build-extension-chrome.sh
/Users/x/code/pass/scripts/build-extension-firefox.sh
/Users/x/code/pass/scripts/build-extension-safari.sh
```

## 设计约束
- 改共享目录的一处代码，Chrome / Firefox / Safari 三个平台壳层会一起生效
- Chrome / Firefox 壳层通过符号链接引用共享文件
- Firefox 打包时会解引用符号链接，生成可分发的 `.xpi`
- Safari 由 Xcode 工程直接引用共享源码并构建宿主 App
