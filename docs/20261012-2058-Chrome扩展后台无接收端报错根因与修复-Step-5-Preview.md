# Chrome 扩展「Receiving end does not exist」报错根因与修复

> 撰写时间：2026-10-12 20:58 ｜ 模型：Step-5-Preview
> 关联版本：1.8.1 ｜ 影响面：Chrome Web 扩展（`apps/extension_chrome_web` / `apps/extension_shared`）

## 现象

网页内（密码框附近）弹出 Pass 的红色提示条，内容是 Chrome 的英文原话：

```
Could not establish connection. Receiving end does not exist.
```

自动填充的账号选择浮窗不出现，保存/更新确认也不出现。

## 根因

**不是代码逻辑错误，是 Chrome 里加载的扩展注册状态失效。** 完整因果链：

1. Chrome 中加载的 Pass 扩展是**旧注册**：`chrome://extensions` 卡片显示版本 **1.8.0**，而仓库 `apps/extension_chrome_web/manifest.json` 早已在磁盘上更新为 **1.8.1**（`dist/` 也重建过）。
2. 磁盘文件变化后没有在 `chrome://extensions` 点「重新加载」，MV3 的 background service worker 注册变为**无效**——卡片上「检查视图」显示 `Service Worker (无效)`。
3. 页面 content script 调 `chrome.runtime.sendMessage` 时没有可用的接收端，Chrome 抛 `chrome.runtime.lastError`，消息原文即 "Could not establish connection. Receiving end does not exist."。
4. `apps/extension_shared/content.js` 的 `runtimeSendMessage()` 把 `lastError.message` **英文原文直接透传**（content.js:858-859），刷新填充列表失败时又把它原样弹成页面 toast（content.js:974-975），所以用户看到的是 Chrome 原话而不是友好提示。

关键证据：本次用**全新打开的页面**复现（content script 是新注入的，排除"旧页面残留脚本"），照样报错；且同一时刻 `chrome://extensions` 卡片明确显示 `Service Worker (无效)`。用户在扩展页点「重新加载」后版本变为 1.8.1、功能立即恢复，反证根因。

## 实测复现方法（已通过）

用 Apple 自带系统能力在后台操作本机 Chrome，不需要装任何自动化框架：

```bash
# 1. 本地起一个带登录表单的测试页（http://127.0.0.1:8791，<all_urls> 可注入）
#    表单含 #username / #password
# 2. AppleScript 新开标签页并打开该页面
osascript -e 'tell application "Google Chrome" to make new tab at end of tabs of front window with properties {URL:"http://127.0.0.1:8791/login.html"}'

# 3. AppleScript 执行 JS 聚焦用户名框
osascript -e 'tell application "Google Chrome" to execute front window'\''s active tab javascript "document.querySelector(\"#username\").focus()"'

# 4. System Events 发一个真实 Tab 键（可信事件 + 用户激活），焦点落到密码框
osascript -e 'tell application "System Events" to key code 48'
```

第 4 步是关键：`hasUserActivationForFillChooser()`（content.js:918）只认「指针点在字段上」或「Tab/Shift+Tab 键盘导航」，程序化 `focus()` 不算用户激活，会被静默处理、不弹任何提示。真实 Tab 键让填充列表请求以 `userInitiated` 发出，失败时才会弹出红色 toast——与用户截图完全一致。

## 修复

开发期每次重新 build 扩展后，必须在 `chrome://extensions` → Pass 卡片点「重新加载」，再刷新已打开的网页。本次由用户操作验证：重载后版本显示 1.8.1，提示条消失，功能正常。

## 排查口诀（下次直接套）

看到 "Receiving end does not exist"：

1. **先看 `chrome://extensions` 卡片**：Pass 的「检查视图」是否显示 `Service Worker (无效)`。是 → 点「重新加载」，刷新页面，结束。
2. 卡片正常 → 再看页面是否是扩展重载/更新前打开的（旧 content script），刷新页面。
3. 两者都排除 → 才去查 `runtimeSendMessage` / background 监听代码。

不要一上来就改代码——这个错 90% 是注册状态问题，不是代码问题。

## 代码缺陷与改进建议（尚未实施，待决定）

`content.js` 目前把 Chrome 英文原文透传给用户，且 `isRuntimeAvailable()`（content.js:1712）只检查 `chrome.runtime.id`，检测不到 worker 缺失。建议：

1. 识别 `lastError.message` 含 "Receiving end does not exist" 的场景，转成中文提示「扩展后台未响应，请刷新页面后重试」。
2. 该场景自动重试一次（worker 被系统回收后首次消息可能唤醒失败），仍失败再提示。
3. 顺带把其它 `lastError` 原文做中文化映射，不再把 Chrome 内部英文抛给终端用户。

## 操作教训（本次踩到）

- **`screencapture` 截图焦点问题**：每轮工具命令执行时，系统会把 WorkBuddy 重新提到前台；`osascript activate Chrome` 之后、下一条命令执行前焦点又被抢回。所以「先 activate 再单独截图」不可靠，连续两次截到 WorkBuddy 窗口，打扰用户。
- 正确做法：**不发焦点的后台操作**（AppleScript 关标签页、`lsof` 杀进程、读写文件）优先；确需截图时 activate 与 `screencapture` 必须放在**同一条命令**里（`osascript ... activate && sleep 1 && screencapture ...`），且要接受可能仍被抢焦点。
- AppleScript 多行脚本（含 `repeat` 循环）在本环境有解析问题，用单行 `-e` 或避免嵌套循环。
- 关测试标签页要用**标签页 ID** 精确定位，不要按 URL 匹配——用户前台有几十个同域标签页，误关会直接打断用户工作。
