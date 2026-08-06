# extension_shared

Pass 浏览器扩展共享核心。

账号、通行密钥、文件夹和历史记录在 IndexedDB 中使用 AES-GCM 加密；启用主密码后，数据密钥由 PBKDF2-SHA-256（310000 次）派生的密钥包裹，解锁后的数据密钥只保存在浏览器会话存储中，锁定时清除。远端同步和同步包导出可选用独立的 256 位同步密钥做 AES-256-GCM 端到端加密；留空则使用明文 `pass.sync.bundle.v2`（可能包含密码与通行密钥材料，仅建议在可信网络/已允许明文的服务器上使用）。启用加密时，跨平台客户端须配置同一密钥。手动同步与自动同步规则一致。永久删除会保留同步墓碑，避免离线设备的旧快照重新生成账号。

同步端点必须使用 HTTPS；仅 `localhost`、`127.0.0.1` 和 `::1` 可为本机开发使用 HTTP。这样可避免 WebDAV Basic 凭据及服务器 Bearer Token 经由网络明文传输。

同步设置支持主同步源选择（默认自建服务器）、WebDAV、自建服务器版本恢复、合并预览和空远端保护；预览阶段不会写入本地数据。Chrome 扩展由后台 Service Worker 统一调度自建服务器与 WebDAV，管理页不直接对每个远端重复调用。

## 安全行为（开发测试版）

- 自动填充会校验活动标签页域名与账号站点是否匹配，并默认只允许 HTTPS（本机 HTTP 例外）。
- 在密码框或用户名框聚焦时，内容脚本会向后台查询当前站点可填充账号列表（不含密码），用 closed Shadow DOM + manual Popover 弹出选择面板；选中后再请求密码并填入焦点表单。
- 账号选择框与保存/更新确认框可从标题或外层留白拖动，并限制在可视区域内，避免被 Chrome 原生密码选择框遮挡。
- 内容脚本不再缓存全库明文密码；保存/更新提示改为向后台查询 `PASS_CONTENT_CHECK_LOGIN`，并使用常驻右上角浮窗等待用户明确选择。相同网站和用户名但密码不同会提示“更新已保存的密码？”，新账号提示“保存这个账号？”。
- 关闭“本地数据保护”后，数据密钥只保留在当前浏览器会话，不会再写回 `chrome.storage.local` 明文。
- 通行密钥选择器使用 closed Shadow DOM，降低页面脚本合成点击绕过的风险。软件 passkey 私钥仍可导出并参与同步，这是已知的产品模型限制，不是硬件认证器替代品。
- 修改共享源码后必须执行 `npm run build`，平台壳层实际加载的是 `dist/`。
  - 版本号以仓库根目录 `VERSION` 为准；`scripts/bump_version.sh` 更新各壳清单，构建会生成 `extension_version.js` 并同步共享 manifest。
  - `webauthn_injected.js` 源码也需打包为 `dist/webauthn_injected.js`（含版本常量）。

## 目录职责
- 这里存放 Chrome / Firefox / Safari 三个平台共用的前端代码与构建脚本
- 平台差异留在各自壳层目录中：
  - Chrome: [`/Users/x/code/pass/apps/extension_chrome_web`](/Users/x/code/pass/apps/extension_chrome_web)
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
  - `webauthn_injected.js`（源）→ `dist/webauthn_injected.js`
  - `extension_version.js`（由 build 从 package.json 生成）
  - `scripts/build.mjs`
  - `dist/`

## 构建
```bash
cd /Users/x/code/pass/apps/extension_shared
npm install
npm test
npm run build
```

Chrome 正式壳层还需要在仓库根目录执行：

```bash
./scripts/build-extension-chrome-web.sh
```

更多网页内浮窗状态流和手工验收见 [`../../docs/browser-extension-in-page-prompts-zh.md`](../../docs/browser-extension-in-page-prompts-zh.md)。

## 一键构建
仓库根目录提供三个一键命令：
```bash
/Users/x/code/pass/scripts/build-extension-chrome-web.sh
/Users/x/code/pass/scripts/build-extension-firefox.sh
/Users/x/code/pass/scripts/build-extension-safari.sh
```

## 设计约束
- 改共享目录的一处代码，Chrome / Firefox / Safari 三个平台壳层会一起生效
- Chrome Web 构建把共享 bundle 同步到正式扩展，Firefox 壳层通过符号链接引用共享文件
- Firefox 打包时会解引用符号链接，生成可分发的 `.xpi`
- Safari 由 Xcode 工程直接引用共享源码并构建宿主 App
