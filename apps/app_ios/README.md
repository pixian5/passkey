# iOS Credential Provider（骨架说明）

> 状态：仓库内**尚无**完整 iOS App / Credential Provider Extension 工程。  
> 本文定义最小骨架与接入约定，便于下一步用 Xcode 创建 target。

## 目标

- 系统「密码」自动填充：`ASCredentialProviderViewController`
- 与 macOS 一样：**业务规则不写在 UI**，只读 vault + 调共享 Core（未来 static lib / XCFramework）
- 数据契约：`pass.data.v2` / 同步 `pass.sync.bundle.v2`

## 建议 Xcode 结构

```text
apps/app_ios/
  PassIOS.xcodeproj
  PassIOS/                 # 主 App（SwiftUI 列表/设置/同步）
  PassCredentialProvider/  # AutoFill Extension
  Shared/                  # 与 macOS 可共享的模型/仓库协议（Swift）
```

## Extension 最小职责

1. `prepareCredentialList`：按 `serviceIdentifier`（域名）查询候选账号（**不含密码**或仅在用户确认后取密）
2. 用户点选 → 解锁（生物识别/主密码）→ 返回 `ASPasswordCredential`
3. 永久删除墓碑 / 软删账号不得出现在候选列表

## 与 Core 的边界

| 允许 | 禁止 |
|------|------|
| 调 Core：域名匹配、列表过滤 | 在 Extension 重写 merge |
| Keychain / App Group 读信封 | 把 DEK 写进 UserDefaults |
| 系统 UI | 网络同步（留给主 App） |

## 近期实现顺序（未开工）

1. 创建 App + Extension target + App Group  
2. 共享容器放加密 SQLite（对齐 macOS）  
3. 链接 `pass-core-ffi`（iOS 需交叉编译 static）  
4. 主 App 先实现解锁与同步；Extension 只读  

## 当前替代

- macOS AutoFill 已存在：`apps/app_macos/AutofillExtension`
- Android Provider 骨架：`apps/android_credential_provider`（demo vault 查询钩子）
