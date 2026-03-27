# copilot-Claude-flutter

Flutter 跨平台桌面端（Windows / Ubuntu / macOS）开发目录。

## 功能
- 设备名称设置与持久化
- 账号新增/编辑/删除/恢复
- 别名域名自动并集合并
- CSV 导出
- 时间格式 `yy-M-d H:m:s`

## 平台说明
- Linux：已在当前 Ubuntu 容器完成 build/test；容器无图形界面时需 `xvfb-run -a flutter run -d linux`。
- Windows：`flutter build windows` 仅支持 Windows 主机执行。
- macOS：在非 macOS 主机上 `flutter build` 不提供 `macos` 子命令；需在 macOS 主机执行。
- 仓库不支持二进制文件，默认图标资源（`.ico` / `.png`）未提交；若构建报图标缺失，请先补齐资源。

## 本地命令
```bash
cd copilot-Claude-flutter
export PATH=/workspace/flutter/bin:$PATH
flutter pub get
dart format lib/main.dart test/widget_test.dart
flutter analyze
flutter test
flutter build linux
```

## 已验证结果（当前容器）
- `flutter analyze`：通过
- `flutter test`：通过
- `flutter build linux`：通过
- `timeout 45s xvfb-run -a flutter run -d linux`：可启动并进入 Flutter 调试会话（45 秒后由 timeout 结束）
- `flutter build windows`：失败（预期，非 Windows 主机）
- `flutter build macos`：失败（预期，非 macOS 主机不提供 macOS build 子命令）
