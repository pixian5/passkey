# 扩展与 macOS 同步 URL 改写缺陷修复

> 当前事实文档。记录一个让扩展 / macOS 客户端无法同步到新服务器 `or.sbbz.tech:5443` 的缺陷根因与修复。
> 提交：`2cf7c670`（已推送 `master`）。版本仍为 `1.8.4`（纯缺陷修复，不 bump 版本，沿用 `369ce5e7` 的惯例）。

## 1. 背景与现象

用户把同步服务器从旧默认（`uk.sbbz.tech:5443`）迁到新主机 `or.sbbz.tech:5443`（AWS us-east-2，
真实 IP `18.225.117.121`），并已完成服务器首次上线（见
[同步服务首上线 or.sbbz.tech](../docs/20261013-0153-同步服务首上线or.sbbz.tech与部署脚本两处修复-Step-5-Preview.md)）。

桌面端（Tauri）首推成功：服务器 `accounts 194 / folders 10 / passkeys 9`。但**浏览器扩展**
在「同步设置」里填 `https://or.sbbz.tech:5443` 后，预览/合并始终失败或打到错误服务器。

## 2. 根因

`normalizeLegacySelfHostedServerBaseUrl`（扩展）与 `normalizedSelfHostedServerBaseURL`（macOS Swift）
里**硬编码了一个改写分支**：

```js
// apps/extension_shared/background.js / options.js
if (host === "or.sbbz.tech" && port === 5443) {
  return DEFAULT_SELF_HOSTED_SERVER_BASE_URL;   // = https://uk.sbbz.tech:5443
}
```

```swift
// apps/app_macos/Sources/app_macos/AccountStore.swift
return (((host == "127.0.0.1" || host == "localhost") && port == 53333)
    || (host == "or.sbbz.tech" && port == 5443))
    ? Self.defaultSelfHostedServerBaseURL
    : trimmed
```

即：只要用户填入 `or.sbbz.tech:5443`，函数就把地址**静默替换成默认服务器 `uk.sbbz.tech:5443`**，
导致扩展与 macOS 客户端永远连不到新服务器。该分支显然是当初调试旧默认服务器时误留的死代码。

- `DEFAULT_SELF_HOSTED_SERVER_BASE_URL` / `defaultSelfHostedServerBaseURL` 仍是 `https://uk.sbbz.tech:5443`
  （历史默认占位），本次**只去掉强制改写**，不动默认占位本身。
- Tauri 桌面端（Rust）**没有**这个改写逻辑，所以桌面端能直接同步到 `or.sbbz.tech:5443`。

## 3. 修复范围（5 个文件）

| 文件 | 说明 |
| --- | --- |
| `apps/extension_shared/background.js` | 源：移除 `or.sbbz.tech:5443` 改写分支 |
| `apps/extension_shared/options.js` | 源：同上 |
| `apps/extension_chrome_web/dist/background.js` | 构建产物：同上（由源重新构建） |
| `apps/extension_chrome_web/dist/options.js` | 构建产物：同上 |
| `apps/app_macos/Sources/app_macos/AccountStore.swift` | macOS 客户端：移除同一改写分支，**保留** `127.0.0.1/localhost:53333` 本地遗留映射 |

扩展 dist 通过 `apps/extension_shared` 的 `npm run build` + 仓库根
`./scripts/build-extension-chrome-web.sh` 刷新，保证源与产物一致。
`127.0.0.1/localhost:53333` 的本地遗留映射属于历史本地开发服务器约定，不在本次修复范围，予以保留。

## 4. 验证

- `git --no-pager diff --stat`：`5 files changed, 1 insertion(+), 14 deletions(-)`（4 处删除改写分支 + Swift 一处三元简化）。
- 仅删除分支，无逻辑新增；diff 干净、彼此隔离。
- 提交 `2cf7c670` 已 `git push origin master`；工作树干净。
- 未 bump 版本：本仓库惯例是缺陷修复不碰 65 处版本源（参考 `369ce5e7`）。

## 5. 遗留：扩展合并仍被原生 `window.confirm` 卡住（自动化无解）

修复 URL 改写后，扩展已能正确指向 `or.sbbz.tech:5443`，但**扩展 → 服务器的「合并」推送仍无法用自动化完成**：

- 合并流程中「主同步源指纹变更确认」用的是 `window.confirm`（`apps/extension_chrome_web/web-main.js:2817`）。
- 本版 Chrome 的**原生 `window.confirm` 不暴露给 System Events**：`entire contents` 只枚举到工具栏
  返回/前进/关闭等按钮，没有 OK/Cancel、没有 AXSheet/AXDialog；Enter/Esc/space 都打不到这个原生弹窗，
  重载能临时消除它，但重新点「合并」立刻又卡住主线程（`execute javascript` 返回 `-1712` 超时）。
- Chrome AppleScript `execute javascript` 运行在扩展页面的 **ISOLATED world**：
  **没有 `chrome.runtime`、没有 `chrome.storage`、读不到主世界全局**，且**不 await promise**
  （`chrome.storage.local.get` 在该上下文永远不会 resolve）。因此：
  - 无法读取/解密 `SYNC_KEY` 来校验或修复 Bearer Token；
  - **`chrome.scripting` / `chrome.tabs` 在扩展自身页面上下文里不可用** → 无法向主世界注入代码，
    也就无法调用 `sync_now_mode`（extension-bridge.js:874，走 SW 直接 `chrome.runtime.sendMessage`、
    本可绕过页面 `window.confirm`）——该绕过路径只存在于主世界，自动化够不到。
- 已确认：保险库**未锁定**（`lockOverlay` display:none、0×0），服务器地址正确为 `https://or.sbbz.tech:5443`。
  **唯一卡点就是那个原生 confirm。**

⇒ **必须由用户在扩展选项页手动点「合并」并确认主同步源变更弹窗。**
（如希望以后换主源不必每次人工点，可把 `web-main.js:2817` 的那次性 `window.confirm` 改为
`quiet` / 编程调用时自动放行，或改为非阻塞提示——属产品决策，本次未改。）

## 6. 收尾与提醒

- 桌面端为绕开 Tauri WebView `window.confirm` 静默返回 false 而临时设的「自动同步·间隔 = 每 1 分钟」
  **已改回「关闭」（0）**，避免每分钟静默打服务器。
- **Bearer Token 太短**（公网暴破风险）：客户端侧建议换成 **32 字节以上随机串**，或在服务器重跑
  `rotate_token.sh` 后在客户端同步更新。（Token 值不入文档、不入记忆。）
- 服务器目前是全新空库，桌面端首推已落地（194/10/9）；扩展合并完成后应与之收敛一致。
