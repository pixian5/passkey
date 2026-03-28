# copilot-53-flutter

基于 Flutter 的桌面端工程，目标平台：

- Windows
- Ubuntu / Linux
- macOS

## 当前实现

- 桌面双栏 UI（左侧录入、右侧列表）。
- 设备名输入并本地持久化。
- 账号新增 / 编辑 / 搜索 / 排序。
- 支持多站点（逗号分隔）、TOTP、恢复码、备注。
- 删除进入回收站，支持恢复与永久删除。
- 账号创建/更新/删除设备与时间元数据记录。
- 一键生成演示数据。
- 关联站点别名自动合并（有交集的账号站点会并集同步）。
- CSV 导出（包含主列表与回收站数据）。
- 自动显示当前运行平台。

## 本地开发

```bash
export PATH=/workspace/flutter-sdk/bin:$PATH
cd apps/copilot-53-flutter
flutter pub get
flutter run -d linux
```

## 构建

```bash
# Ubuntu/Linux
export PATH=/workspace/flutter-sdk/bin:$PATH
cd apps/copilot-53-flutter
flutter build linux

# Windows（需在 Windows 主机执行）
flutter build windows

# macOS（需在 macOS 主机执行）
flutter build macos
```

## 重要说明

- 在 Linux 容器中只能直接构建 Linux 产物；Windows/macOS 产物必须分别在对应系统构建。
- 若命令提示 `flutter` 不存在，请先把 `/workspace/flutter-sdk/bin` 加入 PATH。
- 无图形界面的容器里 `flutter run -d linux` 会出现 `Gtk-WARNING: cannot open display`，这是环境限制；可在有桌面的主机运行，或用 `xvfb-run flutter run -d linux` 做无头调试。
- 为避免仓库 PR 被二进制文件拦截，项目未提交平台图标二进制；如需恢复默认图标，可在项目目录执行：`flutter create . --platforms=windows,linux,macos`。
