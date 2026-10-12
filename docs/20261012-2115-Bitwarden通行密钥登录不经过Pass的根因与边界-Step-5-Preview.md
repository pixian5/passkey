# Bitwarden 通行密钥登录不经过 Pass 的根因与边界

> 撰写时间：2026-10-12 21:15 ｜ 模型：Step-5-Preview
> 关联版本：1.8.1 ｜ 影响面：Chrome Web 扩展 WebAuthn 托管（`apps/extension_shared/webauthn_injected.js`、`passkey_store.js`、`content.js`）
>
> **修订（2026-10-12 22:44，模型 Step-5-Preview，版本 1.8.2）**：本文初版有两处不准确，现已随 PRF 落地修正，详见文末「修订记录」。一句话现状：凭据**确实在** Pass 库里，但因 create 时未返回 PRF，被 Bitwarden 标为「不支持加密」，解锁时其 credentialId 被排除出 `allowCredentials` → `PASSKEY_NOT_FOUND` → 交还浏览器。1.8.2 已实现 WebAuthn PRF（hmac-secret），重注册后即可真正用于 Bitwarden 解锁。实现细节见 `20261012-2244-WebAuthn-PRF实现与Bitwarden通行密钥解锁-Step-5-Preview.md`。

## 现象

Bitwarden 网页库（vault.bitwarden.com）锁定页或登录页点「使用通行密钥登录」/生物识别解锁，页面右上角弹 Pass 提示条：

```
Pass 已切换为浏览器原生处理读取通行密钥
```

解锁没有使用 Pass，用户以为"明明在 Pass 里保存了这条通行密钥"。

## 结论：这是设计内的交还，不是错误

`webauthn_injected.js` 拦截网页的 `navigator.credentials.get` 后，按 `explainGetManageability`（`webauthn_routing.js:32`）决定是否托管。无后缀的这条提示只可能来自两个原因（消息映射见 `webauthn_injected.js:604-634`）：

| 原因 | 触发条件 |
| --- | --- |
| `PASSKEY_NOT_FOUND` | `resolveGetCandidates` 在 Pass 库里找不到 rpId 匹配的凭据（`passkey_store.js:393`）。注意：**Pass 选择器根本不会出现** |
| `PASSKEY_USE_BROWSER` | 选择器弹出来了，但用户点了「关闭」/按 Esc/120 秒超时（`content.js:1596-1605`） |

已排除的可能：**锁定状态不会产生这个 toast**。`PASS_PASSKEY_OPERATION` 在敏感消息名单里（`background.js:159`），库锁定时后台返回 `{ok:false, locked:true, error:"扩展已锁定"}`，错误对象没有 code，`shouldFallbackToBrowser` 返回 false（`webauthn_routing.js:42-45`），WebAuthn 直接抛 `NotAllowedError`，Bitwarden 会显示解锁失败而不是弹交还 toast。

**区分方法**：复现时观察有没有弹出 Pass 的通行密钥选择器（closed Shadow DOM 浮动面板，列凭据 + 「关闭」按钮）。没弹 = `PASSKEY_NOT_FOUND`（库里没有）；弹了 = 需要点面板里那条凭据。

## 架构级根因（修订后）：凭据在 Pass 库，但因缺 PRF 被降级排除

1. **凭据确实在 Pass 的 IndexedDB `passkeys` 集合里**（managed，创建于 2026-10-12 20:49，签名计数 0、最近使用 -）。Pass 拦截 create 是"先斩后奏"：本地无条件保存，再把 attestation 返回给网页，因此即使 Bitwarden 不接受，Pass 里也会出现这条记录。
2. 真正的障碍是 **PRF（hmac-secret）**：Bitwarden 的无密码解锁在 create 时请求 `extensions.prf`，而 Pass 当时只返回 `credProps`（`webauthn_client_data.js`），未给 `hmacCreateSecret`。于是 Bitwarden 把这条凭据登记为「passmac」但标为「不支持加密」（对照 iCloud.com / Google / 1p 均为「用于加密」）。
3. 解锁必须用「支持加密」的凭据派生保险库密钥，所以 Bitwarden 下发的 `get` 的 `allowCredentials` 只含 iCloud/Google/1p 的 credentialId、**排除 passmac**。Pass 按列表过滤后为空 → `PASSKEY_NOT_FOUND` → 弹「已切换为浏览器原生处理」。
4. **1.8.2 已实现 WebAuthn PRF**：Pass 在 create 时生成并保存每凭据 `hmacSecret`、返回 `prf.enabled`；get 时按 salt 计算 HMAC-SHA-256 输出 `prf.results`。Pass 是软件存储、握有全部密钥材料，PRF 完全可实现（并非硬件限制）。修好代码后需删除旧 passmac 并在 Bitwarden 重注册（hmacSecret 仅在 create 时建立），新凭据才会被标为「用于加密」并进 allowCredentials。

## 正确用法与验证

- 该场景就让浏览器原生处理：toast 出现后系统会弹 Touch ID/通行密钥 sheet，用它完成解锁即可，这不是故障。
- 想确认 Pass 库里有没有这条：打开 Pass 选项页 → 左侧「通行密钥 (N)」→ 看列表里有没有 `vault.bitwarden.com`。N=0 即实锤。
- 若确实要在 Pass 里存一条某站的通行密钥：在该站的注册流程里走 Pass 托管（`create` 拦截），但 PRF 类站点（Bitwarden 网页版）除外。

## 待决定的改进（未实施）

`PASSKEY_NOT_FOUND`（库里就是没有）时也弹交还 toast，对"从没想用 Pass 的站点"是噪音。可改为：无匹配凭据时静默交还浏览器，只有"用户主动关闭选择器"才提示。要改的话动 `webauthn_injected.js` 的 `notifyFallbackBeforeBrowser` 调用点（`patchedGet` 里对 `PASSKEY_NOT_FOUND` 跳过通知）。

## 排障过程记录（环境坑，下次直接用）

- **Chrome 多配置文件 = 多个同名进程**：本机主窗口（带 Pass 的配置文件）和另一个只装 TabSave 的配置文件窗口同时存在。AppleScript 的 "Google Chrome" 可能连到**非主配置文件**进程，表现为：`execute javascript` 报"通过 AppleScript 执行 JavaScript 的功能已关闭"——那是**另一个配置文件的偏好设置**（查看→开发者→允许 Apple 事件中的 JavaScript 是 per-profile 的），不是主窗口被关。用 System Events `tell process "Google Chrome" to get name of every window` 可确认当前可见窗口。
- 截图抢焦点：`set frontmost` 与 `screencapture` 放同一条命令、且前一条 osascript 不能报错，否则 WorkBuddy 会把前台抢回去，截到的永远是 WorkBuddy。
- 窗口 ID 超过 2^31 时 AppleScript 会转成科学计数导致"不能获得 window id 2.00xxxxE+9"，不要用 `window id <大整数>` 定位，用序号或 System Events。

## 修订记录

- **2026-10-12 22:44（模型 Step-5-Preview，版本 1.8.2）**：修正初版两处不准确结论——
  1. 「用户保存的通行密钥实际在 Bitwarden 自己的库里，不在 Pass」→ **错**。用户 21:43 截图实证：凭据在 Pass 选项页，managed、创建于 20:49、签名计数 0。真实情况是凭据在 Pass 库，但 Bitwarden 因 PRF 缺失将其标为「不支持加密」并在解锁时排除。
  2. 「Pass 结构上无法代劳 PRF」→ **过强**。Pass 软件存储、握有全部密钥材料，PRF 可实现。1.8.2 已实现 WebAuthn PRF（见 `20261012-2244-WebAuthn-PRF实现与Bitwarden通行密钥解锁-Step-5-Preview.md`），重注册后 passmac 可转为「用于加密」并真正用于解锁。
