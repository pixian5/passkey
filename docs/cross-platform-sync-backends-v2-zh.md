# 跨平台同步后端契约（V2）

## 1. 目标
- 所有平台（macOS、Android、Windows、Linux、Chrome/Firefox 扩展）使用同一同步载荷：`pass.sync.bundle.v2`。
- 自建服务器作为主同步源；iCloud/WebDAV 作为可选备份源，避免多个远端同时裁决形成分叉。
- iCloud 仅作为 Apple 平台专用通道，不作为跨平台协议基线。

## 2. 统一数据格式
- 顶层必须是同步包：
  - `schema: "pass.sync.bundle.v2"`
  - `source.formatVersion: 2`
  - `payload.accounts`
  - `payload.passkeys`
  - `payload.folders`
- `payload.passkeys` 需完整保留托管字段（含 `privateJwk/publicJwk/mode/createCompatMethod`），避免跨端丢字段。
- 不再兼容 v1/legacy。

## 3. WebDAV 后端协议
- 远端对象：一个 JSON 文件（例如 `pass-sync-bundle-v2.json`）。
- 拉取：`GET <webdav-resource-url>`
  - `200`：返回 `pass.sync.bundle.v2`
  - `404`：视为远端无数据
- 推送：`PUT <webdav-resource-url>`
  - Body：完整 `pass.sync.bundle.v2` JSON
  - `2xx` 视为成功
- 认证：可选 Basic Auth。

## 4. 自建服务器后端协议
- 主接口：`/v2/sync/state`
- 兼容接口：`/v1/sync/payload`
- 拉取：`GET /v2/sync/state`
  - `200`：返回 `pass.sync.bundle.v2`
  - `404`：视为远端无数据
- 推送：`PUT /v2/sync/state`
  - Body：完整 `pass.sync.bundle.v2` JSON
  - `2xx` 视为成功
- 认证：可选 `Authorization: Bearer <token>`。

## 5. 客户端同步流程（所有平台一致）
1. 读取主同步源并保存本地同步前快照。
2. 拉取主同步源的远端同步包（404 则按空远端处理）。
3. 用统一合并规则合并本地与主远端：
   - 账号：字段级时间戳优先 + 删除墓碑规则
   - 永久删除：保留 `isPermanentlyDeleted` 墓碑，待后续版本压缩，不立即从同步载荷移除
   - 文件夹：`updatedAtMs` 新者优先
   - 通行密钥：按 `credentialIdB64u` 去重并取最新字段
4. 本地落盘合并结果。
5. 将合并结果作为完整 `pass.sync.bundle.v2` 回写到主同步源；备份源只在用户明确选择时写入。

安全闸门：远端为空时不得清空非空本地；合并结果缺少本地稳定 ID、解密失败或版本冲突时，必须停止写入并保留同步前快照。

## 6. 新平台接入清单
- 实现 `GET/PUT` WebDAV 文件同步（可选）。
- 实现 `GET/PUT /v2/sync/state`（可选），旧客户端可继续使用 `/v1/sync/payload`。
- 复用同一 JSON schema：
  - `docs/schemas/pass-sync-bundle-v2.schema.json`
  - `docs/schemas/pass-data-v2.schema.json`
- 复用同一合并规则。

## 7. 当前状态
- mac App：支持 iCloud / WebDAV / 自建服务器，默认以自建服务器为主同步源。
- Chrome 扩展：支持 WebDAV / 自建服务器，默认以自建服务器为主同步源。
- iCloud：仅 Apple 设备使用，不影响跨平台互通。
