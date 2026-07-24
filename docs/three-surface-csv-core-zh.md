# 三端共享 CSV Core

## 目标

统一 Tauri / Docker Web / Chrome 新扩展的 CSV 转义、解析与浏览器密码导入映射，避免一端能导入、另一端字段错位或公式注入处理不一致。

## 实现

- Rust：`core/pass_core/crates/csvio`
- JS：`core/pass_core/js/csv_core.js`
- 扩展构建复制：`scripts/build-extension-chrome-web.sh`、`apps/codex-tauri/scripts/sync-web-ui.mjs`
- 扩展桥接：`apps/extension_chrome_web/extension-bridge.js` 的 `export_csv*` / `import_browser_csv_text` 走 JS Core

## 规则

1. 单元格转义与 Rust `escape_csv_cell` 对齐：换行变空格、前导 `=+-@\t` 加 `'`、双引号转义。
2. `buildCsv` 表头保持裸写，内容单元格全部转义。
3. 浏览器导入至少识别 `url/website/name`、`username`、`password`、`note`，并剥离 `https://` / `www.`。
4. 导入账号写入本地时补齐 `recordId`、时间戳，并插入 `allRegularAccountIds` 顶部。
5. 不得静默丢掉带逗号/引号的字段。

## 检查

```bash
cd apps/extension_shared && npm test -- tests/csv_core.test.mjs
node scripts/check_command_matrix.mjs
```

## 阶段 E 续：Rust 共享导入

- `pass_csvio::browser_csv_to_account_drafts` 成为浏览器 CSV 导入唯一映射入口。
- Tauri：`apps/codex-tauri/src-tauri/src/exchange.rs` 仅负责把 draft 变成 `PasswordAccount`。
- Docker Web：`imported_accounts_from_csv` 同样只做 draft → 账号装配。
- JS：`core/pass_core/js/csv_core.js` 与 Rust 规则对齐（表头归一化、站点 host 提取、可选用户名密码、TOTP 列）。
- 用户名/密码不再是导入前置条件；有站点即可导入。
