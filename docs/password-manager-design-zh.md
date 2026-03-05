# 跨平台密码管理器设计（浏览器插件 + 手机 APP）

> 跨平台实施细节请见：[cross-platform-architecture-zh.md](/Users/x/code/pass/docs/cross-platform-architecture-zh.md)

## 1. 目标与范围
- 目标：实现浏览器插件与手机 APP 的本地双向同步，支持账号密码、TOTP、恢复码、备注与域名别名管理。
- 平台：Chrome 扩展（MV3）+ iOS/Android APP。
- 本文重点：数据模型、域名策略、同步协议、冲突处理、CSV 导入导出。

## 2. 关键实现约束（先说结论）
- **Chrome 扩展本身不能稳定充当通用本地 TCP 服务器**（MV3 能力受限）。
- 建议落地为：`Chrome 扩展 + 本地同步代理（Native Host）`。
  - 扩展负责 UI、自动填充、二维码展示、触发同步。
  - 本地同步代理负责局域网监听端口、加密通信、数据落盘。
  - 手机 APP 扫码后直连本地同步代理。

## 3. 数据模型

### 3.1 主键（不可变）
- `account_id = canonical_site + created_at_yyyyMMddHHmmss + username_at_create`
- 示例：`baidu.com250101190159xjp`
- 说明：
  - `canonical_site`：创建时的主站点（建议为 eTLD+1）。
  - `created_at`：首次创建时间（UTC，精确到秒）。
  - `username_at_create`：创建时用户名快照（即使后续改用户名也不变）。

### 3.2 账号实体
- `account_id: string`（主键，不可变）
- `sites: string[]`（域名列表，升序，统一小写）
- `username: string`
- `password_cipher: string`（密文）
- `totp_secret_cipher: string`（密文）
- `recovery_codes_cipher: string`（密文）
- `note_cipher: string`（密文）
- `username_updated_at: timestamp`
- `password_updated_at: timestamp`
- `totp_updated_at: timestamp`
- `recovery_codes_updated_at: timestamp`
- `note_updated_at: timestamp`
- `is_deleted: boolean`
- `deleted_at: timestamp|null`
- `last_operated_device: string`
- `created_at: timestamp`
- `updated_at: timestamp`

### 3.3 域名别名组（推荐单独建模）
- `alias_group_id: string`
- `domains: string[]`（升序去重）
- `allow_cross_etld1: boolean`（默认 false）
- `updated_at: timestamp`
- `updated_by_device: string`

说明：  
账号里的 `sites` 字段仍保留（满足你的要求），但同步时以别名组为“真源”，批量回填到所有关联账号。

## 4. 域名规则（满足你的业务要求）

### 4.1 自动规则
- 同站点同 eTLD+1 自动共用账号：`qq.com` 与 `wx.qq.com`。
- 自动归一化：
  - 转小写
  - 去末尾点
  - IDN 转 punycode
  - 通过 Public Suffix List 计算 eTLD+1

### 4.2 人工规则
- UI 提供操作：`将当前域名加入该账号的域名别名组`。
- 可将 `icloud.com / icloud.com.cn / apple.com / apple.com.cn` 手工合并到同一组。

### 4.3 防误合并
- 默认禁止不同 eTLD+1 自动合并（避免 `apple.com.cn` 与 `right.com.cn` 被误绑）。
- 仅在用户明确确认后，才允许跨 eTLD+1 合并，且将 `allow_cross_etld1=true`。

## 5. 同步方案

## 5.1 配对与连接（功能1）
1. 扩展调用本地同步代理，生成一次性配对会话：
   - `session_id`
   - `one_time_token`（60 秒有效）
   - 代理地址（`ip:port`）
   - 代理公钥指纹
2. 扩展显示二维码（上述信息）。
3. APP 扫码后连接本地代理，进行双向认证与密钥协商。
4. 建立加密通道后开始双向同步。

建议：使用 TLS + 证书指纹 pin 或 Noise XX，避免局域网中间人攻击。

## 5.2 双向同步顺序
1. **先同步别名组**（求并集并回填账号 `sites`）。
2. **再同步账号字段**（按字段级时间戳 LWW）。
3. **最后处理删除状态**（按删除规则判定）。

## 5.3 字段冲突规则（更新）
- 每个字段独立比较时间戳：
  - `username_updated_at`
  - `password_updated_at`
  - `totp_updated_at`
  - `recovery_codes_updated_at`
  - `note_updated_at`
- 谁的时间戳新就采用谁。
- 时间戳相同：使用 `last_operated_device` 字典序作为稳定 tie-breaker（或 device_id）。

## 5.4 删除冲突规则（按你的定义）
对于同一 `account_id`：
- 若 `A.deleted_at > max(B.username_updated_at, B.password_updated_at, B.totp_updated_at, B.recovery_codes_updated_at, B.note_updated_at)`  
  则保留删除（双方都设 `is_deleted=true`）。
- 否则撤销删除（双方都设 `is_deleted=false`），并继续字段级合并。

## 5.5 示例伪代码
```ts
function mergeAccount(a: Account, b: Account): Account {
  const m = cloneNewestMeta(a, b);

  // 1) sites 由 alias group 并集计算后回填
  m.sites = unionSorted(a.sites, b.sites);

  // 2) 字段级 LWW
  m.username = newer(a.username, a.username_updated_at, b.username, b.username_updated_at);
  m.password_cipher = newer(a.password_cipher, a.password_updated_at, b.password_cipher, b.password_updated_at);
  m.totp_secret_cipher = newer(a.totp_secret_cipher, a.totp_updated_at, b.totp_secret_cipher, b.totp_updated_at);
  m.recovery_codes_cipher = newer(a.recovery_codes_cipher, a.recovery_codes_updated_at, b.recovery_codes_cipher, b.recovery_codes_updated_at);
  m.note_cipher = newer(a.note_cipher, a.note_updated_at, b.note_cipher, b.note_updated_at);

  // 3) 删除判定
  const bMaxFieldTs = max(
    b.username_updated_at, b.password_updated_at,
    b.totp_updated_at, b.recovery_codes_updated_at, b.note_updated_at
  );
  const aMaxFieldTs = max(
    a.username_updated_at, a.password_updated_at,
    a.totp_updated_at, a.recovery_codes_updated_at, a.note_updated_at
  );

  if (a.is_deleted && a.deleted_at > bMaxFieldTs) return setDeleted(m, a.deleted_at);
  if (b.is_deleted && b.deleted_at > aMaxFieldTs) return setDeleted(m, b.deleted_at);
  return setUndeleted(m);
}
```

## 6. API 草案（本地同步代理）
- `POST /pair/start`：创建配对会话，返回二维码载荷
- `POST /pair/confirm`：APP 使用 token 完成认证
- `POST /sync/pull`：拉取增量（按 `updated_at` 游标）
- `POST /sync/push`：提交本地变更集
- `POST /sync/merge-preview`：返回冲突预览（可选）
- `POST /export/csv`：导出 CSV
- `POST /import/csv`：导入 CSV（幂等去重）

## 7. CSV 规范

### 7.1 列定义（建议）
- `account_id`
- `sites`（用 `;` 分隔，导入时排序去重）
- `username`
- `password_cipher`
- `totp_secret_cipher`
- `recovery_codes_cipher`
- `note_cipher`
- `username_updated_at`
- `password_updated_at`
- `totp_updated_at`
- `recovery_codes_updated_at`
- `note_updated_at`
- `is_deleted`
- `deleted_at`
- `last_operated_device`
- `created_at`
- `updated_at`

### 7.2 导入规则
- 先按 `account_id` 定位记录，不存在则创建。
- 存在则执行与同步同样的合并规则。
- `sites` 字段合并为并集后升序存储。

## 8. 安全基线（必须）
- 主密码派生密钥（Argon2id），仅保存密文，不保存明文密码/TOTP。
- 本地数据库加密（SQLCipher 或等价方案）。
- 同步链路全程加密，配对 token 短时有效且一次性。
- 二维码不包含明文敏感字段，仅包含配对元数据。
- 剪贴板自动清除（例如 30 秒）。
- 自动填充前显示域名校验提示，防钓鱼。

## 9. 浏览器插件 UI（最小可用）
- 首次安装：
  - 输入 `设备名称`（如 `ChromeMac`）
  - 生成 `device_id`
- 登录页弹窗：
  - 识别当前域名与 eTLD+1
  - 提示已有账号
  - 按钮：`将当前域名加入该账号的别名组`
- 账号编辑页：
  - 展示 `sites`（只读列表 + 管理入口）
  - 字段更新时间可查看（用于冲突解释）

## 10. 里程碑（建议）
1. M1：本地数据模型 + 扩展端增删改查 + 自动填充。
2. M2：别名组管理 + 同 eTLD+1 自动归并。
3. M3：本地同步代理 + 二维码配对 + 双向同步。
4. M4：CSV 导入导出 + 冲突可视化 + 安全加固。

## 11. 离线同步策略（按真实发生时间合并）

### 11.1 原则
- 不直接比较“账号当前值”，而是同步“操作事件（op log）”。
- 合并顺序优先级：`因果关系 > 真实时间区间 > HLC > op_id`。
- 目标：在多设备离线场景下，尽可能按真实发生顺序合并，同时保证所有设备最终一致。

### 11.2 事件模型（每次字段变更生成一条 op）
- `op_id = device_id + local_counter`（全局唯一，幂等去重）
- `account_id`
- `field`（`username/password/totp/recovery/note/sites/delete_flag`）
- `op_type`（`set/remove/delete/undelete/add_alias/remove_alias`）
- `value_cipher`（密文值）
- `hlc_physical_ms`、`hlc_logical`（Hybrid Logical Clock）
- `event_time_ms_local`（本地写入时钟）
- `clock_offset_ms`（相对可信时间源偏移）
- `clock_uncertainty_ms`（当前误差上界）
- `device_id`

### 11.3 真实发生时间估计（TrueTime 区间）
- 对每条 op 计算：
  - `lower = event_time_ms_local - clock_offset_ms - clock_uncertainty_ms`
  - `upper = event_time_ms_local - clock_offset_ms + clock_uncertainty_ms`
- 联网时定期对时更新 `clock_offset_ms` 与 `clock_uncertainty_ms`。
- 长时间离线时，按时钟漂移扩大 `clock_uncertainty_ms`，避免“假精确”。

### 11.4 同字段冲突合并规则
对于同一 `account_id + field` 的两个并发 op（A/B）：
1. 若存在因果关系（A happened-before B），则 B 覆盖 A。
2. 若 `A.upper < B.lower`，A 早于 B，B 覆盖 A；反之同理。
3. 若区间重叠（无法确定真实先后），比较 HLC（`physical` 再 `logical`）。
4. 若仍相同，按 `op_id` 字典序稳定兜底。

### 11.5 删除与更新冲突（兼容现有删除语义）
对同一 `account_id`：
- 若删除操作 `delete_op.lower > max(all_field_update.upper)`，判定删除生效（`is_deleted=true`）。
- 若 `delete_op.upper < any_field_update.lower`，判定删除被后续更新覆盖（`is_deleted=false`）。
- 若区间重叠无法判定，记为 `conflict_review=true`，默认不删（防误删）。

### 11.6 字段类型建议
- `username/password/totp/recovery/note`：字段级 LWW Register（使用 11.4 规则）。
- `sites`：OR-Set（支持离线 add/remove 并最终并集收敛）。
- `is_deleted`：Tombstone Register（删除/恢复均为事件）。

### 11.7 同步协议建议（离线友好）
- 每设备维护 `version_vector(device_id -> max_counter_seen)`。
- 同步时仅交换“对方未见过的 op”。
- 应用 op 必须幂等（按 `op_id` 去重）。
- 定期做快照压缩：保留最近审计窗口的 op，历史折叠到状态快照。

### 11.8 伪代码（同字段比较）
```ts
function compareOp(a: Op, b: Op): Op {
  if (happenedBefore(a, b)) return b;
  if (happenedBefore(b, a)) return a;

  if (a.upper < b.lower) return b;
  if (b.upper < a.lower) return a;

  if (a.hlcPhysical !== b.hlcPhysical) return a.hlcPhysical > b.hlcPhysical ? a : b;
  if (a.hlcLogical !== b.hlcLogical) return a.hlcLogical > b.hlcLogical ? a : b;
  return a.opId > b.opId ? a : b;
}
```

## 12. 跨平台 APP 设计（iOS + Android）

### 12.1 技术路线建议
- 推荐路线（稳妥）：
  - UI：Flutter（单代码库，移动端交付快）
  - 核心能力：Dart + 平台插件（Keychain/Keystore、生物识别、本地网络权限）
  - 本地数据库：SQLite + SQLCipher
- 替代路线（安全与复用优先）：
  - UI 原生（SwiftUI + Jetpack Compose）
  - 共享业务层：Kotlin Multiplatform（同步、合并、模型、存储接口）
- 取舍建议：
  - 团队前端能力强、追求速度：优先 Flutter。
  - 团队原生能力强、追求长期可维护和系统能力深度：优先 KMP + 原生 UI。

### 12.2 APP 分层（推荐）
- `presentation`：页面与状态管理（登录、列表、编辑、冲突页、同步页）。
- `domain`：账户模型、域名别名规则、离线合并引擎（op log + HLC）。
- `crypto`：主密钥派生、字段加解密、密钥轮换、生物识别解锁。
- `storage`：SQLCipher 持久化、索引、快照与操作日志。
- `sync`：配对、增量同步、向量时钟、冲突处理。
- `platform`：扫码、剪贴板、系统自动填充、网络权限与后台任务。

### 12.3 与浏览器插件的边界
- 扩展负责：
  - 采集当前站点信息
  - 自动填充交互
  - 发起二维码配对
- APP 负责：
  - 账号主数据管理
  - 本地加密存储
  - 离线合并与冲突解释
- 同步代理负责：
  - 局域网连接接入
  - 加密隧道与会话控制
  - 变更集交换（push/pull）

### 12.4 APP 端关键页面
- 首次引导：创建主密码、录入设备名、启用生物识别、导入历史 CSV。
- 账号列表：按域名别名组聚合展示。
- 账号详情：字段级更新时间、编辑历史、删除/恢复。
- 域名别名管理：新增/移除域名，跨 eTLD+1 二次确认。
- 同步中心：扫码连接、最近同步结果、冲突处理记录。
- 安全中心：密钥轮换、导出、锁定策略、设备管理。

### 12.5 平台差异与权限
- iOS：
  - 本地网络访问需在 `Info.plist` 声明用途描述。
  - ATS 默认限制不安全传输，调试环境应仅对白名单放开。
- Android：
  - Android 13+ 涉及附近设备/Wi-Fi 相关能力需声明并请求对应权限。
  - 通过 Network Security Config 控制明文流量策略，默认禁用 cleartext。

### 12.6 后台与可靠性
- 同步任务使用“可恢复队列”：失败重试（指数退避 + 抖动）。
- 每次同步保存 `sync_session_id` 和审计记录，支持问题回放。
- 关键操作（删除、恢复、密钥轮换）写审计日志并可导出。

### 12.7 测试矩阵（最少）
- 单元测试：域名归一化、别名合并、冲突排序、删除判定。
- 集成测试：双设备离线编辑后重连同步、CSV 导入冲突。
- 端到端测试：扩展扫码配对 -> 双向同步 -> 自动填充验证。
- 安全测试：本地数据库泄露场景、MITM、重放攻击、越权访问。

## 13. 还需要补充的内容（建议优先）
1. 数据库 DDL 与索引设计（`accounts/op_logs/alias_groups/version_vectors`）。
2. 配对协议细节（握手、证书 pin、token 失效与重放保护）。
3. 自动填充策略（仅 HTTPS、子域匹配、钓鱼防护提示规则）。
4. 错误码体系（同步/导入/解密/权限）与用户可读文案。
5. 灾备策略（冷备份、密钥恢复、设备丢失后吊销）。
