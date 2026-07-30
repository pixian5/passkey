# 跨平台同步后端契约（V2）

> 当前实现参考：Tauri、Docker Web、Chrome Web 扩展。SwiftUI、Firefox、Safari 和 Android 仍是平台能力/迁移模块，不宣称已经具备三端管理面全部能力。

## 1. 数据与服务器边界

- 客户端交换 `pass.sync.bundle.v2`；启用同步密钥时，远端实际保存 `pass.sync.encrypted.v1` AES-256-GCM 信封，服务端不解密业务字段。
- 服务端是哑存储，只负责认证、版本快照、审计、ETag/If-Match、幂等写入和恢复，不做字段级合并。
- Token 和同步密钥均可为空。Token 为空是显式开放模式；同步密钥为空时保存明文 V2 包，必须只在可信链路使用。
- 永久删除记录保留墓碑和稳定 ID，不能被旧设备的活动记录复活。

## 2. 自建服务器

主接口：

- `GET /v2/sync/state`
- `PUT /v2/sync/state`
- `GET /v2/sync/versions`
- `GET /v2/sync/versions/{versionId}`
- `POST /v2/sync/versions/{versionId}/restore`

兼容接口：`GET/PUT /v1/sync/payload`。

请求写入现有状态时必须携带 `If-Match`；服务器返回 `ETag`、`X-Sync-Revision` 和版本信息。`412`/`428` 表示并发条件失败，客户端重新拉取、合并并重试；每次逻辑写入使用 `Idempotency-Key`。Bearer 认证可选，服务器没有配置令牌时不应要求客户端发送 `Authorization`。

## 3. WebDAV

Tauri、Docker Web 和 Chrome Web 扩展支持通过 HTTPS WebDAV 读写一个 JSON 资源，Basic Auth 可选，并使用 ETag/If-Match 做并发保护。Chrome 在后台 Service Worker 中发请求，依靠 manifest host permission 跨域；管理页只提交设置和一次同步意图，不直接请求 WebDAV。

## 4. 客户端流程

1. 同步即将替换本地 payload 时创建本地安全快照；纯“本地覆盖云端”不修改本地，无需为本地创建替换快照。
2. 从主源拉取远端包；启用的其它源作为镜像，仅接收主源合并后的结果。
3. 客户端按字段时间戳、设备名和值做确定性 LWW；文件夹归属、别名、Passkey 关联和永久删除使用关系墓碑。
4. 合并结果通过安全闸门：空远端不能清空非空本地；稳定 ID 缺失、解密失败、版本冲突时停止写入。
5. 主源写入成功后再写镜像源；失败源记录报告，不掩盖已完成/未完成来源。

Chrome 后台一次处理全部启用来源，因此能力声明为 `managedMultiSourceSync: true`，共享 UI 只调用一次 `sync_now_mode`。其它表面声明为 false，由共享 UI 按来源调用。`sync_webdav_now_mode` 在 Chrome 也委托同一个后台入口，用于保持命令契约，不启动第二个同步引擎。

同步模式：

- `merge`：字段级合并并写回。
- `remoteOverwriteLocal`：主源覆盖本地，要求远端非空且先确认风险。
- `localOverwriteRemote`：本地覆盖主源，要求先确认风险。
- `preview`：只计算报告，不落盘、不推送。

## 5. 统一载荷字段

`payload` 至少包含 `accounts`、`folders`、`passkeys`、顶层 `allRegularAccountIds`、`folderOrderIds` 及其排序时间戳/设备名。每个文件夹保存 `regularAccountIds`；数组位置就是该作用域的普通账号顺序。账号字段和顺序字段分开合并。

## 6. 当前能力矩阵

| 能力 | Tauri | Docker Web | Chrome Web |
|---|---|---|---|
| 自建服务器 | 已接入 | 已接入 | 已接入 |
| WebDAV | 已接入 | 已接入 | 已接入（后台调度） |
| 自建服务器版本列表/恢复 | 已接入 | 已接入 | 已接入 |
| SSH 创建服务 | 实际执行 | 保存草稿/有限检测 | 保存草稿 |
| 本地快照/导入预览 | 已接入 | 已接入 | 已接入；管理页可恢复后台同步快照 |

WebDAV 没有自建服务器的版本列表、审计和恢复接口。同步服务器限流按 TCP 对端 IP；反向代理场景当前没有可信 `X-Forwarded-For` 解析，必须在部署层单独评估。

详细命令覆盖以 [`three-surface-command-matrix-zh.md`](./three-surface-command-matrix-zh.md) 和代码门禁为准。
