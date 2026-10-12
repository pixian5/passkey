# WebAuthn PRF 实现与 Bitwarden 通行密钥解锁

> 撰写时间：2026-10-12 22:44 ｜ 模型：Step-5-Preview ｜ 版本：1.8.2（后续修订至 1.8.3）
> 关联：`20261012-2115-Bitwarden通行密钥登录不经过Pass的根因与边界-Step-5-Preview.md`（该文档已随本实现修订）
> 影响面：Chrome Web 扩展 WebAuthn 托管 + 同步合并层（JS 真源 + Rust）+ Schema

## 背景

Bitwarden 的无密码解锁（passkey unlock）依赖 **WebAuthn PRF（hmac-secret）扩展**：注册（create）时请求 `extensions.prf`，用认证器返回的每凭据 HMAC 密钥派生保险库解密密钥。缺 PRF 的凭据虽能注册，但会被 Bitwarden 标为「不支持加密」（对照「用于加密」），解锁时其 credentialId 被排除出 `allowCredentials`，导致 Pass 侧 `PASSKEY_NOT_FOUND` 并交还浏览器原生。本文档记录为 Pass 补齐 PRF 的实现。

Pass 把通行密钥密钥材料保存在自身加密库（软件存储），握有全部私钥，因此 PRF 完全可实现——不是硬件限制。

## PRF 语义（hmac-secret）

- **create**：请求 `extensions.prf` 时，认证器生成每凭据 `hmacSecret`（32 字节随机），返回 `clientExtensionResults.prf = { enabled: true }`。
- **get**：请求 `extensions.prf.eval = { first, second? }`（或 `evalByCredentialId`）时，认证器计算 `results.first = HMAC-SHA-256(hmacSecret, first)`、`results.second = HMAC-SHA-256(hmacSecret, second)`，base64url 返回。
- 关键：`hmacSecret` **只在 create 时建立**，无法事后补发——旧凭据必须删除并在站点重注册才能获得 PRF 能力。

## 实现改动

### WebAuthn 核心（`apps/extension_shared`）

- `webauthn_client_data.js`：`buildCreateClientExtensionResults(extensions, { prfEnabled })` 新增 `prfEnabled`，请求 PRF 时返回 `{ prf: { enabled: true } }`。
- `passkey_store.js`：
  - 新增常量 `PRF_HMAC_SECRET_BYTE_LENGTH = 32`。
  - `createManagedCredential`：请求 PRF 时 `bytesToBase64url(randomBytes(32))` 生成 `hmacSecretB64u` 存入凭据；`clientExtensionResults` 带上 `prf.enabled`。
  - `getManagedAssertion`：新增 `resolvePrfEval`（支持 `eval` 与 `evalByCredentialId`）+ `computePrfResults`（`crypto.subtle` HMAC-SHA-256），算出 `clientExtensionResults.prf.results`；无请求或凭据缺 `hmacSecret` 时返回 `{}`。
  - 新增 `ensureUint8Array`：兼容 ArrayBuffer / Uint8Array / 视图 / base64url 字符串的 salt 输入。

### 同步合并层（否则字段会被白名单重建丢光）

`hmacSecretB64u` 必须随通行密钥同步，否则其他设备无法用同一凭据算 PRF，且合并时若按字段白名单重建会把它丢弃：

- `core/pass_core/js/sync_merge_core.js`：`mergeSamePasskey` 增加 `hmacSecretB64u: newer || older || null`。
- `apps/extension_shared/{options,popup,background}.js`：`normalizePasskeyShape` 增加 `hmacSecretB64u` 透传（这三处是显式字段重建，不加会被丢）。
- Rust（与 JS 合并对拍的权威实现）：
  - `crates/merge/src/v2/types.rs`：`Passkey` 增加 `hmac_secret_b64u: Option<String>`。
  - `crates/merge/src/v2/merge.rs`：`merge_same_passkey` 增加 `hmac_secret_b64u` 透传（`normalize_passkey_shape` 为就地修改，字段入 struct 后自动保留）。
- `docs/schemas/pass-data-v2.schema.json`：`passkey` 定义增加可选 `hmacSecretB64u`（该定义 `additionalProperties: false`，且被 `pass-sync-bundle-v2` 复用）。

## 测试

- 新增 `apps/extension_shared/tests/passkey_prf.test.mjs`（7 例）：create 含/不含 PRF、get 双 salt / 单 salt / `evalByCredentialId`、未请求 PRF、旧凭据缺 secret 返回空。其中 HMAC 输出与 Node 内置 `crypto.createHmac("sha256", hmacSecret, salt)` 逐字节比对，证明输出正是 RP（Bitwarden）期望的值。
- `webauthn_client_data.test.mjs`：补 `prfEnabled` 两例。
- 结果：`npm test` 184/184 通过；Rust `cargo test -p pass-merge` 31/31 通过；`node js/check_merge_parity.mjs` 48 例 JS↔Rust 对齐通过；`node scripts/version.mjs check` 64 项一致。

## 使用方式（用户操作）

1. 本实现已构建进 `apps/extension_chrome_web/dist`（版本 1.8.2）。在 `chrome://extensions` **重新加载** Pass 扩展（版本变为 1.8.2）。
2. 到 Bitwarden「无密码登录」设置页，**移除**旧的那条 `passmac`（它注册时无 hmacSecret，永远停在「不支持加密」，无法原地救活）。
3. 在 Bitwarden 重新走一遍「使用通行密钥解锁」注册流程，这次走 Pass 托管——新凭据会被标为「**用于加密**」。
4. 此后解锁时 Bitwarden 的 `allowCredentials` 会包含 Pass 凭据，Pass 的选择器出现，选中后用 Touch ID/系统完成解锁。

## 注意事项

- `hmacSecretB64u` 与私钥同属敏感材料，随通行密钥存入加密库并同步；其安全等级等同 `privateJwk`。
- 同步多台设备时，合并层已透传该字段，其他 Chrome 实例可直接用同一凭据算 PRF，无需再次注册。
- `buildCreateResultFromStoredPasskey`（同账号重注册复用路径）当前未被调用，本次未改；若日后启用需同样补 PRF。

## 修订记录

### 2026-10-12 22:58（模型 Step-5-Preview，版本 1.8.3）：修复 PRF 跨进程序列化丢 salt

**现象**：1.8.2 下 create 成功且 `clientExtensionResults.names: ["prf"]`（注册诊断实证），但 Bitwarden 紧接着的「读取通行密钥」（带 PRF 的 get）报红字「读取通行密钥时出错」。

**根因**：注入层（isolated world）经 `chrome.runtime.sendMessage` 把 `extensions` **原样**透传给后台，而 `sendMessage` 走 **JSON 序列化**——PRF 的 salt 是 `ArrayBuffer`，JSON 化后变成 `{}`，后台 `resolvePrfEval` 拿不到 salt → PRF 输出为空 → Bitwarden 派生密钥失败。（`challenge` 不受影响，因为它早已被转成 base64url。）

**修复**：
- 出站：`webauthn_injected.js` 新增 `serializeExtensions`/`serializePrfExtension`/`serializePrfValues`，把 `prf.eval` / `prf.evalByCredentialId` 的 salt 转成 `firstB64u`/`secondB64u`；`passkey_store.js` 的 `resolvePrfEval` 改读 `firstB64u ?? first`。
- 入站：`buildAssertionCredential`/`buildCreateCredential` 经 `deserializeClientExtensionResults` 把后台返回的 `prf.results.first/second`（base64url）还原为 **ArrayBuffer**，符合 WebAuthn 规范对 `clientExtensionResults.prf.results` 的类型要求。
- 新增测试「get 的 PRF salt 以 base64url（firstB64u/secondB64u）传入时同样可计算」；`npm test` 185/185。

**教训**：任何经 `chrome.runtime.sendMessage` 传递的 WebAuthn 扩展数据，二进制字段（salt、结果）都必须显式 base64url 编解码，不能依赖原样透传。
