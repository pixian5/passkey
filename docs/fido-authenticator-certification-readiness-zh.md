# Pass FIDO2 认证器认证准备

> 目标：让 Pass 成为可被严格 RP（包括 Google direct 注册路径）验证的 FIDO2 软件认证器。
> 当前版本：`1.5.7`。本文是工程准备清单，不代表已经取得 FIDO 或 Google 认证。

## 结论

Pass 当前的 Chrome 页面桥接可以生成符合 WebAuthn 语法的凭据，但它不是受信任的 FIDO 认证器：

- 没有认证器专用的 attestation key 和证书链；
- 没有稳定的产品 AAGUID 与 FIDO Metadata Statement；
- macOS AutoFill 扩展只实现密码凭据；
- Android Credential Provider 目前只声明密码能力，passkey create/get 仍是占位实现。

因此不能通过修改 `fmt`、AAGUID 或签名字段临时获得 Google 的信任，也不能冒用其他厂商的 AAGUID。

## 认证范围

Pass 应申请 **FIDO2 Software Authenticator**，至少达到 Authenticator Certification Level 1（L1）。功能认证、认证器安全认证和 Metadata Service 发布是不同步骤：服务器功能认证不能替代认证器认证。

官方入口：

- [FIDO 用户认证认证项目](https://fidoalliance.org/fido-user-authentication-certification-programs/)
- [FIDO 功能认证流程](https://fidoalliance.org/certification/functional-certification/)
- [FIDO Metadata Service](https://fidoalliance.org/metadata/)

## 工程工作包

### A. 原生认证器服务

需要新增一个由 Pass 原生进程控制的服务，页面扩展只负责传递受 RP 验证的请求：

- 解析并校验 RP ID、origin、challenge、用户验证策略和算法；
- 生成 discoverable credential，保存 credential ID、user handle、公钥和私钥引用；
- 实现创建/断言认证数据、sign counter、UV、BE/BS 和 excludeCredentials；
- 私钥只能通过 Keychain/Secure Enclave、Android Keystore 或受控 HSM 使用，不返回明文私钥；
- 对每次注册和断言记录脱敏的协议审计事件。

### B. 认证器身份与证明

- 为 Pass 产品生成一个长期稳定且只属于 Pass 的 AAGUID；
- 由受控 attestation key 对注册数据签名；
- 建立证书链和根证书轮换策略；
- 编写 FIDO Metadata Statement，声明算法、UV 方法、备份能力、传输方式和认证器版本；
- 在认证通过后将 Metadata Statement 发布到 FIDO MDS；
- 任何开发/测试密钥都必须与生产 attestation key 隔离。

### C. 平台 Provider

- macOS：补齐 passkey 注册/断言能力；现有 `ASCredentialProviderViewController` 仅支持密码 AutoFill，不能直接视为 passkey provider。
- Android：补齐 Credential Manager 的 `PublicKeyCredential` create/get、解锁确认和结果回传；当前模块 README 已明确标注为 password-only scaffold。
- Chrome/Firefox：改为调用本机 Pass 原生服务，不再由页面 JavaScript 生成生产 attestation。

### D. 认证前测试

1. WebAuthn 规范向量和本地服务端验签。
2. FIDO Conformance Tools 自验证。
3. 至少一轮 FIDO Interoperability Testing。
4. Google 测试账号注册、登录、删除、重复注册和备份状态回归。
5. 断电、锁定、恢复、跨设备同步和密钥轮换测试。

## 外部步骤（必须由产品主体完成）

以下步骤需要你的公司/个人法律主体、FIDO 账号、签名和费用，我不能代签或冒充申请人：

1. 注册 FIDO Alliance 认证账号并签署 NDA。
2. 提交认证器产品名称、供应商身份、版本和 AAGUID 规划。
3. 支付认证和实验室测试费用，预约 FIDO 认证实验室或测试活动。
4. 提交安全设计、威胁模型、密钥生命周期、源代码/构建证明和测试报告。
5. 取得认证后发布 Metadata，并向 Google 申请该 AAGUID/证书根的注册策略确认。

FIDO 认证不等于 Google 自动允许注册；Google 仍可以基于账号风险、认证器类型或自己的 allowlist 拒绝 direct 注册，所以必须在投入认证前获得 Google 的书面确认。

## 通过标准

只有同时满足以下条件，Pass 才能声称“支持 Google strict direct 注册”：

- FIDO2 Software Authenticator L1 认证完成；
- 生产 attestationObject 的证书链可由 RP 验证；
- AAGUID、Metadata Statement、证书根和产品版本一致；
- 私钥不经过页面 JavaScript 或普通扩展存储；
- Google 明确确认该 AAGUID/证书根可用于目标注册路径；
- 真机完成注册后，Google 账号页面显示新通行密钥，并能用 Pass 完成断言登录。

在这些条件完成前，Pass 只能安全地提供匿名 `none` 或自证明测试模式，不能把测试 AAGUID 当作生产认证器。
