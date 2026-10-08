# extension_safari

Safari Web Extension wrapper for the shared Pass browser extension. Safari is a platform shell and is not proven equivalent to the Tauri / Docker Web / Chrome Web management surfaces.

## What it is
- Generated from `/Users/x/code/pass/apps/extension_shared`
- Reuses the Chrome extension source files directly
- Safari wrapper project lives at:
  - `/Users/x/code/pass/apps/extension_safari/PassSafari/PassSafari.xcodeproj`

## Current structure
- Safari host app bundle id: `com.pass.safari`
- Safari extension bundle id: `com.pass.safari.Extension`
- macOS only

## Open in Xcode
```bash
open /Users/x/code/pass/apps/extension_safari/PassSafari/PassSafari.xcodeproj
```

## Build from terminal
```bash
cd /Users/x/code/pass/apps/extension_safari/PassSafari
xcodebuild -project PassSafari.xcodeproj -scheme PassSafari -configuration Debug -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

Built app:
- `/Users/x/code/pass/apps/extension_safari/PassSafari/build/Build/Products/Debug/PassSafari.app`

## Apple Development 签名
带签名安装需要 Xcode 项目的 `PSTNW3UN4R` 团队在本机钥匙串中有可用的
`Apple Development` 证书和私钥。脚本会先检查该条件，避免把无签名产物误报为
可安装的 Safari 扩展：

团队按证书主题的 `OU` 字段识别，证书名称末尾的开发者标识不能代替团队。
当前环境缺少该团队证书，因此尚未更新原团队安装包。1.8.1 的共享同步后台已在
Safari（苹果浏览器）27.0.1 独立临时扩展中通过 10 项真实场景；临时实测不能
替代原团队签名、安装与完整产品验收。详见[本轮记录](../../docs/20261008-1926-Safari扩展实测与发布收尾-GPT-6.md)。

```bash
cd /Users/x/code/pass/apps/extension_safari
./scripts/build_signed_safari.sh
```

What it does:
- kills any old `PassSafari` process
- cleans the old derived data
- builds the Safari host app with the local `Apple Development` certificate already installed on this Mac
- installs the built app to `/Applications/PassSafari.app`
- re-registers it with LaunchServices
- launches the new app

只有需要验证编译时，使用无签名模式：

```bash
cd /Users/x/code/pass/apps/extension_safari
./scripts/build_signed_safari.sh --unsigned
```

无签名模式不会修改 `/Applications/PassSafari.app`，不能据此确认原团队扩展已更新。
若签名检查失败，请在 Xcode 中登录 `PSTNW3UN4R` 团队并下载或创建
该团队的开发证书及私钥；不要用另一团队的证书替换项目团队配置。

扩展目标继承项目的 macOS 26.3 最低版本，不再覆盖为当前工具链不支持的 10.14。

## 独立临时扩展验证

可通过 Safari 的“设置 → 开发者 → 添加临时扩展”加载隔离的资源目录。该操作可能
要求启用“允许未签名的扩展”并由用户完成系统认证；不能将其当作普通文件选择。
测试目录使用独立名称和合成数据，仅申请回环主机权限，不加载原扩展数据。

本轮运行实际后台、浏览器存储与回环测试服务，覆盖 10 项同步场景。测试结束后
卸载临时扩展、关闭测试页面及服务，恢复原先的未签名扩展开关。清单不需要
内容脚本时删除 `content_scripts`，不要填空数组，以免 Safari 报清单条目无效。

测试脚本、结果和产物摘要保存在本轮压缩验证包中。后台实测、无签名构建、原团队
签名安装和完整产品验收分别记录，不能互相替代。

## Enable in Safari
1. Build and run `PassSafari.app` once.
2. Open Safari.
3. Go to `Safari > Settings > Extensions`.
4. Enable `PassSafari Extension`.
5. If needed, allow it on all websites.

## Data safety during development reinstall

Safari development installs can assign a new `safari-web-extension://` storage
origin. Do not clear Safari website data or delete the Safari profile while
updating this app. The extension now detects legacy collection rows copied to a
new origin and re-encrypts them automatically, but the old website-data folder
should still be kept until the updated extension has been opened and verified.

## Notes
- The generated Safari project references files from `/Users/x/code/pass/apps/extension_shared` instead of copying them, so we keep one extension codebase.
- Before building Safari, rebuild the shared web extension bundle if JS changed:
```bash
cd /Users/x/code/pass/apps/extension_shared
npm run build
```
- Safari converter reported that `clipboardRead` is not supported by the current Safari version. Clipboard-related flows may need Safari-specific fallback behavior later.
- The source `manifest.json` currently has no icon entries, so the generated Safari project used default assets.
- Current capability boundaries are tracked in [`../../docs/current-app-extension-implementation-reference-zh.md`](../../docs/current-app-extension-implementation-reference-zh.md); do not infer Chrome management parity from the Safari wrapper alone.
