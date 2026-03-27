# copilot-53-tauri

`copilot-53-tauri` 是 `pass` 的 Tauri 2 桌面端工程，目标平台：

- Windows（`msi` / `nsis`）
- Ubuntu / Linux（`deb` / `AppImage`）
- macOS（`dmg` / `.app`）

## 功能对齐目标（参考 app_macos）

当前已实现以下核心能力（跨平台版本）：

- 设备名设置与持久化。
- 账号新增 / 编辑（site、username、password、totp、recovery codes、note）。
- 别名域自动合并（账号 site 集合有交集时自动取并集）。
- 回收站（软删除、恢复、彻底删除）。
- 生成演示账号。
- CSV 导出。
- 时间显示格式与 macOS 版一致：`yy-M-d H:m:s`。

## 开发运行

```bash
cd apps/copilot-53-tauri
npm install
npm run tauri dev
```

## Ubuntu 构建依赖

如果 Ubuntu 环境缺少 `glib-2.0` / `gio-2.0` / `webkit2gtk`，先安装：

```bash
sudo apt update
sudo apt install -y \
  build-essential \
  pkg-config \
  libgtk-3-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

## 打包

```bash
cd apps/copilot-53-tauri
npm run tauri build
```

如果当前 Linux 环境无法正常执行 `linuxdeploy`（常见于精简容器），可先仅打 `deb` 包：

```bash
cd apps/copilot-53-tauri
npm run tauri build -- --bundles deb
```

产物默认在 `apps/copilot-53-tauri/src-tauri/target/release/bundle/`：

- Windows: `msi` / `nsis`
- Ubuntu/Linux: `deb` / `appimage`
- macOS: `dmg` 与 `.app`

## 数据位置

- SQLite（WAL）：`<app_local_data_dir>/pass-copilot-53-tauri.db`
- CSV 导出：`<app_local_data_dir>/pass-export-*.csv`

## 说明

- 当前版本以开发测试为目标，重点先保证三端可跑与核心流程可用。
- UI 仍是基础风格，后续可继续向 macOS 版细节（交互、视觉、结构）靠齐。
- 为避免 PR 被“二进制文件不支持”拦截，仓库不再提交 Tauri 新图标二进制；当前通过 `src-tauri/icons/icon.png -> ../../../../pass.png` 软链接满足本地构建。
