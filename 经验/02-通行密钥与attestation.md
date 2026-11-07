# 通行密钥与 attestation

> 适用范围：`apps/extension_shared` 的 WebAuthn 托管（create/get）、Chrome dist、PRF 扩展、同步合并透传。
> 结论状态：标注【已验证】者有实测日志或单测；【推测】者未闭环，落地前先做小实验。

## 1. 谷歌的通行密钥永远进不了 Pass：这是硬边界，不是 bug

**现象**：谷歌注册页只弹黄条「Pass 未接管保存通行密钥，本次改由浏览器原生处理：网站要求可验证认证器证明」；Console `create-intercepted {manageable:false, reason:'attestation-required-by-rp'}`。
**根因**：谷歌在 create 里要求 `attestation: direct/enterprise`（可验证认证器证明）。Pass 是软件认证器，只能产出匿名证明（`fmt="none"` + 全零 AAGUID + 空 `attStmt`），没有 FIDO 认证私钥与元数据链。
**1.9.6 实验（坐实）**：移除让位规则让 Pass 接管，扩展全链路成功（`managed-by-pass` → `create-bridge-success`，拿到真实 credentialId），但谷歌服务端返回 `RpcError` +「无法保存您所做的更改」——匿名证明被服务端拒绝。1.9.7 已精确回滚，恢复让位。
**已推翻**：「移除 attestation 让位就能让谷歌用 Pass」——被实测否定。
**正确做法**：`direct`/`enterprise` 一律让位系统认证器；能进 Pass 的只有 `none`/`indirect`/缺省。用户想用谷歌密钥，就使用 iCloud 钥匙串里已有那枚，或换不同认证器新建。
**出处**：`docs/20261013-1421-谷歌通行密钥注册因attestation不接管实锤诊断-Hy3.md`「终局实验」、提交 `254ee692`（1.9.7）

## 2. attestation 守卫要放在桥接层，且放在合法性校验之后

**现象**：路由层已让位，但任何绕过注入脚本直接调桥接的调用方（其他壳层、未来重构、直接 message）仍会静默拿到不合规凭据，日志也无痕迹。
**根因**：守卫只存在于 `webauthn_routing.js` 的路由判断，桥接层 `createManagedCredential` 无防御。
**正确做法**：
- 在 `passkey_store.js` 桥接层抛 `NotSupportedError` + code `PASSKEY_USE_BROWSER`（复用既有让位白名单，不要新造错误码）；
- 守卫位置放在 `challenge`/`rpId`/`user.id` 校验**之后**，否则会改变错误优先级（缺 `user.id` 且声明 `direct` 时应先报 `PASSKEY_USER_MISSING`）；
- `attestation` 只接受字符串，非字符串记 `create-attestation-unknown`，不要 `String(x || "none")` 静默降级；
- `indirect`/`undefined`/`""` 仍由 Pass 托管，必须有测试锁住。
【已验证】1.9.9 将守卫下移并新增顺序锁测试。
**出处**：`docs/20261019-0910-通行密钥注册桥接层attestation守卫与代码审查-deepseek-v4.1-flash-1017.md`、提交 `f3d4a068`（1.9.9）

## 3. 让位后仍失败，先看原生日志，不要先怀疑 Pass

**现象**：让位后页面抛 `InvalidStateError: The user attempted to register an authenticator that contains one of the credentials already registered with the relying party.`（code 11）。
**根因**：WebAuthn 规定 RP 在 `excludeCredentials` 里给出已注册 ID，认证器发现自己持有其中之一时必须返回 `InvalidStateError`。这是**同一认证器重复注册**，与 Pass 无关；谷歌本身不限注册数量，跨认证器随便加。
**正确做法**：
- 直接用该认证器上已有的那枚登录；
- 或换一个不同认证器（Android 密码管理工具 / 1Password / 另一台设备）新建；
- 或先在 RP 管理页删掉该认证器上那枚，再重建。
**判据**：看 `create-fallback-native-success` / `create-fallback-native-error` 两条日志；`*-error` 的错误名就是原生侧原因（`NotAllowedError`=用户取消或系统认证器拒绝）。
**出处**：`docs/20261013-1421-…-Hy3.md`「最终根因实锤」

## 4. 页面固定文案不能当成功证据

**现象**：「确认完毕！现在，您可以使用您的指纹…」看起来像注册成功。
**根因**：这是谷歌账户页自带文案，与本次操作结果无关。
**正确做法**：只认 Console 日志和原生弹窗/钥匙串条目；`create-intercepted` 的 `reason` 是唯一稳定判据：

| reason | 含义 | 结果 |
| --- | --- | --- |
| `attestation-required-by-rp` | 要求可验证证明（谷歌即此） | 故意让位 |
| `google-legacy-appid-request` | 旧式 AppID 外置密钥 | 故意让位 |
| `cross-platform-requested` | 要求外置安全密钥 | 故意让位 |
| `missing-challenge-or-user-id` | 请求参数不完整 | 让位 |
| `managed-by-pass` | Pass 可接管 | 密钥进 Pass |

**出处**：`docs/20261013-1421-…-Hy3.md`「判定方法」

## 5. 失败实验会留下孤儿凭据，且不会自动清理

**现象**：1.9.6 两次谷歌实验在 Pass 里留下两枚从未在谷歌注册成功的凭据（rpId `google.com`）。
**根因**：Pass 的 create 是「先本地落库再返回」，`createMode: "replaced"` 只在同 `rpId` + 同 `userHandle` 的**下一次成功注册**时替换；谷歌注册永远失败，所以永远不会替换。
**正确做法**：做会写入本地的实验前，先记下 rpId/userName 便于事后清理；实验后手动在通行密钥列表删除孤儿条目。判断「拒绝路径不写凭据」的测试必须断言前置长度 ≥ 1 且按 `rpId + userName` 精确断言不存在，否则 `0 === 0` 是空转。
**出处**：`docs/20261019-0910-…-deepseek-v4.1-flash-1017.md`「遗留」与「不写凭据断言去空转」

## 6. PRF（hmac-secret）必须在 create 时建立，且要能同步

**现象**：Bitwarden 里 Pass 凭据被标为「不支持加密」，解锁时其 credentialId 被排除出 `allowCredentials` → `PASSKEY_NOT_FOUND` → 交还浏览器。
**根因**：Pass 早期 create 只返回 `credProps`，未返回 `prf.enabled`、未保存 `hmacSecret`；Bitwarden 只用「支持加密」的凭据派生库密钥。
**正确做法**：
- create：每凭据生成 32 字节 `hmacSecretB64u` 存入凭据，`clientExtensionResults.prf = { enabled: true }`；
- get：按 `eval` / `evalByCredentialId` 的 salt 算 `HMAC-SHA-256`，以 base64url 返回 `prf.results`；输出与 Node `crypto.createHmac("sha256", secret, salt)` 逐字节一致（已有测试）；
- **`hmacSecret` 只在 create 时建立，无法事后补发**：旧凭据只能删除后在站点重注册；
- 同步链路必须透传 `hmacSecretB64u`：`mergeSamePasskey`（JS+Rust）、`normalizePasskeyShape`（options/popup/background 三处显式重建）、`docs/schemas/pass-data-v2.schema.json`（该定义 `additionalProperties: false`，漏加会被 schema 拒）。
**已推翻**：「凭据在 Bitwarden 自己库里」与「Pass 结构上无法代劳 PRF」——前者实际在 Pass 库，后者软件存储握有全部密钥材料，PRF 可实现。
**出处**：`docs/20261012-2244-WebAuthn-PRF实现与Bitwarden通行密钥解锁-Step-5-Preview.md`、`docs/20261012-2115-Bitwarden通行密钥登录不经过Pass的根因与边界-Step-5-Preview.md`

## 7. `chrome.runtime.sendMessage` 会 JSON 化，二进制必须显式 base64url

**现象**：PRF create 成功，紧接着带 PRF 的 get 报「读取通行密钥时出错」。
**根因**：注入层把 `extensions` 原样透传，`sendMessage` 走 JSON 序列化，salt 的 `ArrayBuffer` 变成 `{}`，后台拿不到 salt，PRF 输出为空。
**正确做法**：出站把 `prf.eval`/`evalByCredentialId` 的 salt 转 `firstB64u`/`secondB64u`；入站把后台返回的 `prf.results.first/second`（base64url）还原为 `ArrayBuffer`（规范要求类型）。任何经消息通道传递的 WebAuthn 二进制字段都按此处理，不要依赖原样透传。
**出处**：`docs/20261012-2244-…-Step-5-Preview.md`「修订记录 1.8.3」

## 8. 让位提示的两种来源要分清

- `PASSKEY_NOT_FOUND`：Pass 库里没有 rpId 匹配的凭据，**选择器根本不会出现**。
- `PASSKEY_USE_BROWSER`：选择器出现了，但用户点关闭/Esc/120 秒超时。
- 库锁定时**不会**产生这条 toast：后台返回 `{ok:false, locked:true}`，错误无 code，`shouldFallbackToBrowser` 为 false，WebAuthn 直接抛 `NotAllowedError`，站点显示解锁失败。
**推测**：对「从未想用 Pass」的站点，`PASSKEY_NOT_FOUND` 也弹提示是噪音；可改为无匹配时静默交还，只有用户主动关闭选择器才提示（未实施）。
**出处**：`docs/20261012-2115-…-Step-5-Preview.md`

## 9. 已知成本：让位前固定 1200ms sleep

`webauthn_injected.js` 在让位前无条件 `sleep(FALLBACK_NOTICE_DELAY_MS)`（1200ms），提示去重有单独窗口但 sleep 没有，每次都白等，等于从 RP 的 timeout 预算里扣。改动会影响提示可见性，需真机确认后再动。
**出处**：`docs/20261019-0910-…-deepseek-v4.1-flash-1017.md`「未改动项」
