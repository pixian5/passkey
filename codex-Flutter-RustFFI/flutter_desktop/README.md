# flutter_desktop (codex-Flutter-RustFFI)

Flutter 桌面端实现目录（Windows / Ubuntu / macOS）。

## 已实现功能
- 设备名称设置与持久化
- 账号新增/编辑/软删除/恢复/永久删除
- 站点别名自动并集合并
- CSV 导出
- 时间格式 `yy-M-d H:m:s`

## 平台与主机限制
- Linux：可在 Ubuntu 构建和运行；无图形界面容器需 `xvfb-run -a flutter run -d linux`。
- Windows：`flutter build windows` 仅支持 Windows 主机。
- macOS：非 macOS 主机上 `flutter build` 不提供 `macos` 子命令；需在 macOS 主机构建。

## 仓库限制（无二进制文件）
- 当前仓库按“无二进制文件”约束管理，默认图标二进制资源（`.ico` / `.png`）未提交。
- 若在 Windows/macOS 主机构建时因图标缺失报错，请先补充平台图标资源后再构建。

## 本容器验证命令
```bash
cd codex-Flutter-RustFFI/flutter_desktop
export PATH=/workspace/flutter/bin:$PATH
flutter pub get
dart format lib/main.dart test/widget_test.dart
flutter analyze
flutter test
flutter build linux
timeout 45s xvfb-run -a flutter run -d linux
```
