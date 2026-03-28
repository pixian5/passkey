# flutter_desktop (codex-Flutter-RustFFI)

Flutter 桌面端实现目录（Windows / Ubuntu / macOS）。

## 已实现功能
- 设备名称设置与持久化
- 账号新增/编辑/软删除/恢复/永久删除
- 站点别名自动并集合并
- CSV 导出
- 时间格式 `yy-M-d H:m:s`
- Rust FFI 最小闭环：`init/shutdown/health/version/ping/compare_bounds`
- Rust FFI 业务下沉：账号 CRUD（含回收站）、别名并集合并、CSV 导出

## 平台与主机限制
- Linux：可在 Ubuntu 构建和运行；无图形界面容器需 `xvfb-run -a flutter run -d linux`。
- Windows：`flutter build windows` 仅支持 Windows 主机。
- macOS：非 macOS 主机上 `flutter build` 不提供 `macos` 子命令；需在 macOS 主机构建。

## 仓库限制（无二进制文件）
- 当前仓库按“无二进制文件”约束管理，默认图标二进制资源（`.ico` / `.png`）未提交。
- 若在 Windows/macOS 主机构建时因图标缺失报错，请先补充平台图标资源后再构建。

## 本容器验证命令
```bash
# 0) 若容器缺少 Flutter，可先安装（当前环境已验证可用）
cd /workspace
git clone --depth 1 https://github.com/flutter/flutter.git flutter-sdk
export PATH=/workspace/flutter-sdk/bin:$PATH
flutter --version

# 1) Linux 桌面依赖（缺失会导致 flutter build linux 报 gtk+-3.0 not found）
apt-get update
apt-get install -y libgtk-3-dev clang cmake ninja-build pkg-config liblzma-dev xvfb

# 2) 构建 Rust FFI
cd /workspace/passkey/core/pass_core
cargo build -p pass-core-ffi

# 3) Flutter 验证
cd codex-Flutter-RustFFI/flutter_desktop
flutter pub get
dart format lib/main.dart test/widget_test.dart
flutter analyze
flutter test
flutter build linux
timeout 45s xvfb-run -a flutter run -d linux
```

## 运行方式说明（重要）
- Flutter 桌面程序会在启动时尝试加载 Rust 动态库：
  - Linux: `libpass_core_ffi.so`
  - macOS: `libpass_core_ffi.dylib`
  - Windows: `pass_core_ffi.dll`
- 若动态库不在默认搜索路径，请设置环境变量：
  - `PASS_CORE_LIB_PATH=/absolute/path/to/libpass_core_ffi.so`（按平台替换后缀）
- 当前 Flutter 页面层已切换为 FFI 调用；若 Rust 动态库缺失，相关操作会在 UI 中报错并无法完成。
