# Pass 三端统一方案（Tauri / Docker Web / Chrome Web 扩展）

> 范围：管理界面、命令契约、同步语义、平台能力边界。  
> 不在本方案内：旧版 `apps/extension_chrome` / `apps/extension_shared` 遗留 options UI。旧插件继续并行保留，待新版确认后再删除。

## 1. 目标

三端对用户应表现为“同一套 Pass 管理软件”，只在平台能力上有明确差异：

| 表面 | 入口 | 前端 | 后端命令适配 |
|---|---|---|---|
| Tauri 桌面 | `PassDesktop.app` | `apps/codex-tauri/src/*` | Rust Tauri commands |
| Docker / Ubuntu Web | `pass-web` HTTP | 同一 UI 的 `dist` | Rust `pass-web` `/api/invoke/:command` |
| Chrome 新扩展 | `web-options.html` | 从 Tauri UI 同步生成 | `extension-bridge.js` |

原则：

1. **UI 单源**：`apps/codex-tauri/src/main.js` + `styles.css` + `index.html` 是唯一管理页源码。
2. **命令同名**：UI 只调用统一命令名；各表面实现同一接口。
3. **同步同核**：账号/文件夹/通行密钥/顺序字段合并由 `pass_merge::v2` 与共享 Schema 裁决。
4. **能力显式声明**：`health_check.capabilities` 告诉 UI 当前表面支持什么，不靠猜运行时环境。
5. **桌面专属能力可降级**：SSH 创建服务、Touch ID、原生目录选择器、部分 WebDAV/服务器版本能力可隐藏或给出明确错误，但不得导致页面崩溃。

## 2. 当前差异（代码事实）

### 2.1 界面

- CSS 已一致。
- 管理页 JS/HTML 原先通过复制维护；现已改为构建时从 Tauri 源同步到：
  - `apps/extension_chrome_web/web-main.js`
  - `apps/extension_chrome_web/web-options.css`
  - `apps/extension_chrome_web/web-options.html`
- Docker Web 本来就读取 `apps/codex-tauri/dist`。

### 2.2 命令覆盖

UI 调用约 66 个命令。  
重叠能力：账号/文件夹 CRUD、排序、置顶、回收站、撤销重做、历史、同步设置、同步预览/合并、同步包导入导出、CSV、快照、主密码锁。

| 能力 | Tauri | Docker Web | Chrome Web 扩展 |
|---|---|---|---|
| 账号/文件夹/排序/回收站 | 完整 | 完整 | 完整 |
| 字段级同步合并 | Rust Core | Rust Core | JS 本地合并（自建服务器可用） |
| 文件夹顺序同步 | 完整 | 完整 | 完整 |
| 文件夹去重 | 完整 | 完整 | 完整（本轮补齐） |
| WebDAV | 完整 | 完整 | 未实现，明确报错 |
| 服务器版本列表/恢复 | 完整 | 完整 | 未实现，明确报错 |
| SSH 创建服务 | 完整 | 草稿/检测 only | 草稿 only |
| Touch ID / 生物识别 | macOS | 无 | 无 |
| 原生目录选择器 | 有 | 无（浏览器下载） | 无（浏览器下载） |
| 页面自动填充 / content script | 无 | 无 | 有（扩展独有） |

### 2.3 存储

| 表面 | 本地存储 |
|---|---|
| Tauri | 加密 SQLite KV + 本地 vault 封装 |
| Docker Web | 加密 vault 文件 + 密钥文件 |
| Chrome Web 扩展 | `chrome.storage.local` / 插件独立空间 |

数据模型统一为 v2 账号/文件夹/通行密钥 + 顶层顺序字段；存储介质可以不同。

## 3. 统一架构

```text
                ┌──────────────────────────────┐
                │  Shared Web UI (single source)│
                │  main.js / styles / index.html│
                └──────────────┬───────────────┘
                               │ invoke(command, args)
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   Tauri runtime         pass-web HTTP        extension-bridge
   generate_handler      /api/invoke/:cmd     chrome.storage
          │                    │                    │
          └──────────┬─────────┴──────────┬─────────┘
                     ▼                    ▼
              pass_merge::v2         payload v2 schema
              field LWW + orders     accounts/folders/passkeys
```

### 3.1 UI 生成规则

- `npm run prepare:dist`（Tauri/Docker）会：
  1. 生成 `apps/codex-tauri/dist`
  2. 同步 UI 到 `apps/extension_chrome_web`
- `scripts/build-extension-chrome-web.sh` 也会强制同步 UI，避免扩展加载旧副本。
- 禁止手改 `web-main.js` / `web-options.css` / `web-options.html`。

### 3.2 能力声明契约

`health_check` 必须返回：

```json
{
  "app": "codex-tauri|pass-web|pass-extension-chrome-web",
  "surface": "tauri-desktop|docker-web|chrome-extension-web",
  "capabilities": {
    "nativeFilePicker": true,
    "sshProvision": true,
    "biometricUnlock": true,
    "webdavSync": true,
    "serverVersions": true,
    "folderDedup": true,
    "selfHostedSync": true,
    "localSnapshots": true,
    "sharedWebUi": true
  }
}
```

UI 启动时读取并隐藏/降级不支持控件。

### 3.3 同步语义（已统一 / 继续坚持）

顶层同步字段：

- `allRegularAccountIds` + 时间戳/设备名
- `folderOrderIds` + 时间戳/设备名
- 每个 `Folder.regularAccountIds` + 时间戳/设备名

规则：

1. 内容字段与顺序字段独立 LWW。
2. 文件夹内容合并与文件夹列表顺序合并独立。
3. 胜出顺序遗漏的活动实体追加到末尾。
4. 删除/永久删除不占活动顺序。
5. 固定“新账号”文件夹始终第一。

### 3.4 命令契约

所有表面实现同一命令名和近似返回形状。平台不支持的命令：

- 优先返回可读中文错误；
- 对“列表类”可返回空数组并在 UI 侧隐藏入口；
- 不允许静默 no-op 且假装成功。

## 4. 本轮已统一

1. UI 单源同步脚本：`apps/codex-tauri/scripts/sync-web-ui.mjs`
2. Tauri prepare-dist / 扩展构建自动同步 UI
3. 三端 `health_check.capabilities`
4. UI 按能力隐藏 SSH 创建服务、生物识别偏好、服务器版本入口
5. 扩展补齐文件夹去重
6. 扩展恢复快照时保留文件夹顺序字段
7. 扩展端点健康检测改为真实 HTTP `/health`，不再伪装成 SSH 能力
8. 新版扩展同步合并直接使用 `core/pass_core/js/sync_merge_core.js`，删除扩展内的简化合并器
9. 扩展构建自动复制共享合并 Core 与同步策略，桥接脚本以 ES module 加载
10. Rust/JS payload parity 覆盖全部账号顺序、文件夹顺序和文件夹内账号顺序
11. 扩展本地数据、同步包和安全快照完整保留三类顺序及其更新时间、设备名

## 5. 明确不统一 / 后续阶段

### 5.1 必须保留的平台差异

- **Touch ID**：仅 macOS 桌面。
- **SSH 创建服务**：仅桌面；Web/扩展只保存草稿，避免公开网页获得远程执行能力。
- **原生文件选择器**：仅桌面；Web/扩展用下载/上传。
- **浏览器自动填充 / WebAuthn 注入**：仅扩展。

### 5.2 后续应继续统一的部分

优先级从高到低：

1. **扩展 WebDAV**
   用浏览器 `fetch` + 可选 CORS/代理方案，或明确文档为桌面/Web 专属。
2. **扩展服务器版本**
   若自建服务器 API 已有版本接口，扩展可只读恢复。
3. **命令矩阵自动化测试**
   从 UI `invoke("...")` 提取命令清单，对三端生成覆盖表和 stub 检测。
4. **共享后端领域层**
   中长期把 vault mutation 从 Tauri/Web 重复逻辑抽到 `pass_core`，扩展继续用 JS 适配层。

## 6. 验收标准

1. 修改 `apps/codex-tauri/src/main.js` 后，执行 prepare-dist 或扩展构建，扩展 options 页面同步变化。
2. 三端 `health_check` 都带 `capabilities`。
3. 同一同步包在 Tauri / Web / 扩展导入后，账号字段、文件夹顺序、全部账号顺序一致（在共享 Core 路径下）。
4. 扩展不再出现“去重按钮点了没反应”。
5. 桌面专属按钮在扩展/Web 上隐藏或给出清晰错误，不出现英文堆栈或空白失败。
6. `npm run test:core-parity` 必须比较完整 payload 顺序字段，不能只分别比较账号、文件夹和通行密钥集合。

## 7. 开发操作

```bash
# 桌面 / Docker 静态资源
cd apps/codex-tauri && npm run prepare:dist

# 新版 Chrome 扩展
cd apps/extension_shared && npm run build
../../scripts/build-extension-chrome-web.sh

# Web 后端
cd apps/pass-web && cargo test && cargo build --release
```

旧扩展 `apps/extension_chrome` 继续保留，不在本方案替换范围内。
