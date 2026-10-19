# 通行密钥注册：桥接层 attestation 守卫与代码审查（1.9.8）

- 时间：2026-10-19 09:10
- 版本：1.9.7 → 1.9.8
- 范围：`apps/extension_shared`（`passkey_store.js`、`webauthn_diagnostics.js`、`webauthn_routing.js` 相关测试）、Chrome 扩展 dist 产物
- 性质：代码审查 + 加固；不改变任何已生效的路由行为

## 背景

1.9.6 曾移除「RP 要求可验证证明时让位」的判据，让 Pass 接管谷歌注册；实测凭据生成成功（`create-bridge-success`），但谷歌服务端直接拒绝（`RpcError` +「无法保存您所做的更改」）。1.9.7 已回滚该实验并恢复让位。

对 1.9.6→1.9.7 这段改动集做只读审查后，发现的问题不在回滚本身（回滚是精确的），而在两处：测试语义与真实链路自相矛盾，以及 attestation 守卫只存在于注入脚本的路由层、桥接层毫无防御。

## 审查结论

回滚正确、无阻断问题。审查发现 2 个 P1、3 个 P2，本次修掉 P1 全部与 P2 三项；剩 1 项（让位前固定 sleep）属行为变更，未动。

## 改动清单

### 1. 桥接层补 attestation 守卫（P1-2，核心）

`apps/extension_shared/passkey_store.js` 的 `createManagedCredential` 在 `assertRpIdAllowedForHost` 之后新增：

```js
const attestation = String(publicKey?.attestation || "none").trim().toLowerCase();
if (attestation === "direct" || attestation === "enterprise") {
  logPasskeyStore("create-attestation-unsupported", { rpId, host, attestation });
  throw new PasskeyError("NotSupportedError", `托管实现无法满足 ${attestation} 认证器证明要求`, "PASSKEY_USE_BROWSER");
}
```

理由：托管实现只能产出匿名证明（`fmt="none"` + 全零 AAGUID + 空 `attStmt`），这是能力边界而非参数问题。原先唯一守卫是 `webauthn_routing.js` 的路由判断；任何绕过注入脚本直接调用桥接的调用方（其他壳层、未来重构、直接 message 调用）都会静默拿到一枚不合规凭据，且日志里没有任何痕迹。

选 `PASSKEY_USE_BROWSER` 而不是新造错误码，是因为 `shouldFallbackToBrowser` 已经认这个 code，上层会自动走既有让位链路，不需要新增机制。`PASSKEY_CREDENTIAL_EXISTS` 同理不在白名单里，`InvalidStateError` 会正确冒泡给 RP 而不是被吞掉。

### 2. 修正误导性测试（P1-1）

`apps/extension_shared/tests/google_passkey_registration.test.mjs`：

- 原测试用 `attestation: "direct"` 直接调用桥接并断言 `verified: true`，但这条路径在生产里永远走不到（路由层已让位），测试名「Google 风格 direct 请求的托管实现保持匿名证明协议正确」读起来像「谷歌可用」，与 1.9.6 的实测结论直接冲突。
- 改为 `attestation: "none"`（唯一能真正到达桥接的形态），测试名改为「到达桥接的托管请求只能产出协议合法的匿名证明」，并在测试体上方写明：本测试只证明协议自洽，不代表 RP 接受匿名证明。
- 新增测试「RP 要求 direct/enterprise 时桥接拒绝落库，交由上层让位」：对 `direct` / `enterprise` / `DIRECT` 三种写法断言路由层 `attestation-required-by-rp`、桥接层 `ok:false` + `NotSupportedError` + `PASSKEY_USE_BROWSER`，并比对调用前后 `getPasskeys()` 长度不变，确认拒绝路径不写孤儿凭据。

### 3. 补 indirect 回归测试（P2-1）

`apps/extension_shared/tests/webauthn_routing.test.mjs` 新增：`indirect` / `undefined` / `""` 三种输入仍为 `managed-by-pass`。

`indirect` 放行是规范允许的（客户端可以用 none 证明替换 indirect），但此前没有测试锁住；若日后有人把它并入 direct 一起让位，会误伤只发 indirect 的站点，且不会有任何测试变红。

### 4. 删除死代码（P2-2）

`passkey_store.js` 删除 `dedupePasskeysForAccount`（原 302-310 行）与 `buildCreateResultFromStoredPasskey`（原 312-391 行）。两者全仓库零引用，打包器早已 tree-shake（`dist/background.js` 里搜不到这两个名字），留着只会让人误以为存在第二条落库/凭据构造路径。

### 5. 修正反直觉布尔写法（P2-3）

`apps/extension_shared/webauthn_diagnostics.js` 的 `anonymousAttestationIsConsistent`：

```js
// 改前（逻辑正确但反向首句极易被后人"修正"成 bug）
fmt !== "none" || aaguidIsZero === true
// 改后
fmt === "none" ? aaguidIsZero === true : true
```

语义不变：匿名证明要求 AAGUID 全零，非匿名格式不受此约束。

## 未改动项

**让位前固定 `sleep(FALLBACK_NOTICE_DELAY_MS)` = 1200ms 无条件执行**（`webauthn_injected.js:707-710`）。提示去重有 `FALLBACK_NOTICE_DEDUPE_MS`，但 sleep 没有，每次让位都白等 1.2s，等于从 RP 的 timeout 预算里扣；也让 `webauthn_fallback_logging.test.mjs` 单测要跑约 3.6s。

没有改动，因为这是可观测的行为变更（提示可能来不及显示就被原生弹窗覆盖），需要真机确认提示是否还有意义，不在本次审查范围内。

## 验证

| 项 | 结果 |
| --- | --- |
| `apps/extension_shared && npm test` | 202/202 通过（原 200，新增 2 条） |
| `node scripts/version.mjs bump` | 1.9.7 → 1.9.8 |
| `node scripts/version.mjs check` | `VERSION_CHECK_OK 1.9.8 (71 entries)` |
| `npm run build` + `scripts/build-extension-chrome-web.sh` | dist 已含新判据与 1.9.8 版本戳 |
| `bash scripts/test_all.sh` | 代码失败：无；环境不可用：无（含领域 FFI 对拍、命令矩阵 72、Markdown 链接 77 文件） |

## 遗留

1. 1.9.6 实验在 Pass 里留下的两枚谷歌孤儿凭据（`y7Jbi4fK…`、`AmVNRkoV…`）仍在，需手动删除。注意 `createMode: "replaced"` 只会在同 `rpId` + 同 `userHandle` 的下一次成功注册时替换，而谷歌注册永远失败，所以不会自动清理。
2. 让位前 1200ms sleep 的取舍（见上）。
3. 谷歌通行密钥仍不可进 Pass，属安全硬边界：RP 要求 `direct`/`enterprise` 时，软件认证器没有 FIDO 认证链，只能让位系统认证器。可行路径是直接用已存在的 iCloud 钥匙串那枚登录，或换不同认证器（Android 密码管理工具 / 1Password / 另一台设备）新建。
