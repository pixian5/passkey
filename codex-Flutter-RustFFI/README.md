# codex-Flutter-RustFFI

本目录用于沉淀「Flutter 桌面端 + Rust Core(F​​FI)」的完整开发设计与落地执行方案，目标覆盖 Windows / Ubuntu / macOS。

## 文档索引
1. [01-目标与边界.md](./01-目标与边界.md)
2. [02-架构设计.md](./02-架构设计.md)
3. [03-开发计划-到完成.md](./03-开发计划-到完成.md)
4. [04-FFI接口规范草案.md](./04-FFI接口规范草案.md)
5. [05-验证与交付清单.md](./05-验证与交付清单.md)
6. Flutter 实现目录：[`flutter_desktop/`](./flutter_desktop/README.md)

## 关键进展
- 已新增 `flutter_desktop` Flutter 桌面工程，包含 Linux / Windows / macOS 三端工程脚手架。
- 已完成 `flutter analyze`、`flutter test`、`flutter build linux` 验证闭环。
- 已完成 Linux 容器运行验证：`timeout 45s xvfb-run -a flutter run -d linux` 可进入调试会话。
- 已打通 Rust FFI 最小能力：`init/shutdown/health/version/ping/compare_bounds`，Flutter 设置页可查看 FFI 健康状态与动态库路径。
- 已将账号 CRUD（含回收站）、别名合并、CSV 导出核心逻辑迁入 Rust FFI；Flutter 侧改为调用 FFI 并持久化 Rust 返回的 `state.json`。

## 重大限制（已落文档）
- `flutter build windows` 仅支持在 Windows 主机执行。
- 在非 macOS 主机上，`flutter build` 不提供 `macos` 子命令；macOS 构建需在 macOS 主机执行。
- 无图形界面的 Linux 容器运行桌面程序时，需要通过 `xvfb-run -a` 提供虚拟显示。
- 若容器缺少 `flutter` 命令，可通过 `git clone https://github.com/flutter/flutter.git /workspace/flutter-sdk` + `export PATH=/workspace/flutter-sdk/bin:$PATH` 快速补齐。

## 后续落地方向
- 将现有 `apps/app_flutter` 原型重构为分层结构。
- 按阶段完成 Rust Core FFI 化，逐步减少业务逻辑在 Dart 侧重复实现。
