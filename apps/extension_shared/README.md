# extension_shared

Pass 浏览器扩展共享核心。

账号、通行密钥、文件夹和历史记录在 IndexedDB 中使用 AES-GCM 加密；启用主密码后，数据密钥由 PBKDF2-SHA-256（310000 次）派生的密钥包裹，解锁后的数据密钥只保存在浏览器会话存储中，锁定时清除。远端同步使用独立的 256 位同步密钥进行端到端加密，跨平台客户端必须配置同一密钥。永久删除会保留同步墓碑，避免离线设备的旧快照重新生成账号。

同步端点必须使用 HTTPS；仅 `localhost`、`127.0.0.1` 和 `::1` 可为本机开发使用 HTTP。这样可避免 WebDAV Basic 凭据及服务器 Bearer Token 经由网络明文传输。

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
