# app_flutter

Windows + Ubuntu 桌面版本（Flutter），用于尽可能复刻 macOS 版核心功能（排除 macOS 专有能力）。

## 已实现功能（对齐 macOS 版）
- 设备名称设置与持久化。
- 手动创建/编辑账号：站点、用户名、密码、TOTP、恢复码、备注。
- 别名域名自动同步（账号站点有交集时自动并集合并）。
- 回收站：软删除、恢复、永久删除。
- 生成示例账号。
- 导出 CSV。
- 时间统一显示为 `yy-M-d H:m:s`。

## 未复刻（macOS 专有）
- AutoFill Extension / Keychain / CredentialIdentityStore。
- macOS 菜单栏与多窗口行为。

## Ubuntu 构建依赖（已验证）
```bash
apt-get update
apt-get install -y curl git unzip xz-utils zip libglu1-mesa clang cmake ninja-build pkg-config libgtk-3-dev
```

## Flutter SDK（本容器已解决）
```bash
cd /opt
git clone https://github.com/flutter/flutter.git -b stable --depth 1
export PATH=/opt/flutter/bin:$PATH
flutter --version
flutter doctor -v
```

## 运行（Windows / Ubuntu）
```bash
cd apps/app_flutter
export PATH=/opt/flutter/bin:$PATH
flutter pub get
flutter run -d windows
# 或
flutter run -d linux
```

> 重要限制：
> - `flutter run -d windows` / `flutter build windows` 仅支持在 **Windows 主机** 执行。
> - 若在无图形界面的 Ubuntu 容器中运行 Linux 桌面程序，需要使用虚拟显示（如 `xvfb-run -a`）。
> - 仓库不支持二进制文件，默认图标资源（`.ico`）未提交；Windows 主机构建前需补齐图标文件。

## 构建
```bash
cd apps/app_flutter
export PATH=/opt/flutter/bin:$PATH
flutter build windows
# 或
flutter build linux
```

## 已执行验证（当前容器）
```bash
cd apps/app_flutter
export PATH=/opt/flutter/bin:$PATH
dart format lib/main.dart test/widget_test.dart
flutter analyze
flutter test
flutter build linux
flutter build windows   # 预期失败：仅 Windows 主机支持
flutter run -d linux    # 无 DISPLAY 会失败
timeout 45s xvfb-run -a flutter run -d linux
```

## 数据文件
- 目录：`<ApplicationSupport>/pass-desktop/`
- 状态：`state.json`
- 导出：`pass-export-<timestamp>.csv`
