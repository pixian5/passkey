# macOS Swift 解析崩溃修复记录

日期：2026-08-09

## 根因

Xcode 26.6 构建 PassMac 时，`SWBBuildService` 在 Swift 依赖扫描阶段于 `swift::Parser::skipSingle()` 深递归崩溃。检查发现 `apps/app_macos/Sources/app_macos/AccountStore.swift` 被提交为二进制数据，而不是 Swift 文本；该文件在 `e779a446` 提交中变为约 300 KB 的二进制内容，导致编译器把随机字节当作 Swift 源码解析。

## 修复与验证

已从 `e779a446` 的父提交 `a550063` 恢复完整的 `AccountStore.swift` 源码。恢复后应先用 `file` 确认 Swift 源文件为文本，再运行 PassMac Release 打包；若再次出现相同崩溃，优先检查所有纳入 Xcode 工程的 `.swift` 文件是否被非文本内容覆盖。

本机安装包如果带有 `com.apple.quarantine`，macOS 可能从 App Translocation 临时路径启动。安装冒烟时应确认进程路径为 `/Applications/PassMac.app/Contents/MacOS/PassMac`，并在确认来源可信后移除该本地开发包属性。
