# Toast（提示条）规范 — PassDesktop / codex-tauri

> 实现位置：`apps/codex-tauri/src/main.js`（`showToast` / `toastSuccess` / `toastError` / `toastWarn`）、`apps/codex-tauri/src/styles.css`（`.toast-*`）。  
> **改 UI 提示时必须遵守本文件**，避免再次出现无颜色区分的灰色 toast。

## 1. 等级与颜色（强制）

| 等级 | API | CSS class | 颜色 | 语义 |
|------|-----|-----------|------|------|
| 成功 | `toastSuccess(text)` | `.toast.toast-success` | **绿** `rgba(34, 197, 94, 0.95)` | 操作已成功完成 |
| 失败 | `toastError(text)` | `.toast.toast-error` | **红** `rgba(239, 68, 68, 0.96)` | 错误、失败、异常、拒绝 |
| 警告 | `toastWarn(text)` | `.toast.toast-warn` | **黄** `rgba(234, 179, 8, 0.96)`（深色字） | 取消、风险、未写入、需用户注意但非硬失败 |

- 默认样式 `.toast` 与成功同色（绿），避免漏写 class 时退回暗灰。
- 时长：读取设置项 `uiPrefs.toastDurationSeconds`（默认约 2.5s，设置里可调）。

## 2. 选用规则

1. **优先显式 API**：新代码应写 `toastSuccess` / `toastError` / `toastWarn`，不要只写 `message(...)` 再靠推断。
2. **兼容入口** `message(text, level?)`：
   - 传入第二参数 `"success" | "error" | "warn"` 时按该等级；
   - 未传时用 `inferToastLevel` 根据文案关键字推断（失败词优先，其次警告词，否则成功）。
3. **文案示例**
   - 成功：`已保存`、`同步完成`、`账号已创建`、`已在服务器创建同步服务`
   - 失败：`…失败`、`错误`、`HTTP 401`、`无法…`、`无效…`
   - 警告：`已取消…`、`安全检查未通过，未写入`、`请先…`、`文件夹名不能为空`、`当前无同步密钥`

## 3. 禁止事项

- 不要把失败提示做成成功绿条。
- 不要再引入第三套自定义 toast DOM；统一用 `#output.toast`。
- 不要在 toast 里打印 Token / 密码 / 同步密钥明文（只报告有无、长度、是否 401）。

## 4. 与 macOS（PassMac）对齐方向

- macOS Swift 侧历史实现偏「成功绿 + 可配置时长」；桌面 Tauri 在此基础上补齐 **失败红 / 警告黄**。
- 若改颜色色值，请同步改本文件表格与 `styles.css`，并在 PR 说明中点名本规范。

## 5. 自检清单

- [ ] 成功操作 → 绿  
- [ ] 网络/校验/保存失败 → 红  
- [ ] 用户取消 / 安全闸门拦截 / 缺配置提示 → 黄  
- [ ] 设置里调节「提示时长」后，新 toast 时长生效  
