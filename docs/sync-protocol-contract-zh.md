# 本地同步协议与接口契约（V1）

## 1. 协议目标
- 支持桌面同步代理与移动 APP/扩展之间的安全配对与双向同步。
- 支持离线增量同步、断线重试、幂等重放。
- 协议语义与 Core 合并规则保持一致。

## 2. 传输与安全
- 传输层：
  - 局域网 HTTPS（推荐）或 Noise over WebSocket（二选一）。
- 会话认证：
  - 配对 token（一次性、默认 60 秒过期）。
  - 设备公钥绑定（首次配对写入 `devices`）。
- 请求防重放：
  - 每个请求带 `request_id`（UUID）。
  - 服务端缓存短期 `request_id` 去重（建议 10 分钟）。
- 数据完整性：
  - 请求体携带 `body_sha256`（或由 TLS 层完整保护）。

## 3. 公共约定

### 3.1 Header
- `X-Request-Id`: UUID
- `X-Device-Id`: string
- `X-Protocol-Version`: `1`
- `Authorization`: `Bearer <session_token>`

### 3.2 时间字段
- 所有时间统一 `epoch milliseconds (UTC)`。

### 3.3 编码
- JSON UTF-8
- 密文字段用 base64 字符串传输

## 4. 数据结构

### 4.1 DeviceInfo
```json
{
  "device_id": "ios_abc123",
  "device_name": "iPhone15",
  "platform": "ios",
  "public_key": "BASE64"
}
```

### 4.2 VectorClock
```json
{
  "entries": [
    { "device_id": "ios_abc123", "max_counter": 1203 },
    { "device_id": "mac_xyz789", "max_counter": 998 }
  ]
}
```

### 4.3 Op
```json
{
  "op_id": "ios_abc123-1204",
  "device_id": "ios_abc123",
  "device_counter": 1204,
  "account_id": "apple.com20260305091530alice",
  "field_name": "password",
  "op_type": "set",
  "value_cipher_b64": "BASE64",
  "value_json": null,
  "hlc_physical_ms": 1772680000123,
  "hlc_logical": 2,
  "event_time_ms_local": 1772680000000,
  "clock_offset_ms": -18,
  "clock_uncertainty_ms": 35,
  "lower_bound_ms": 1772679999947,
  "upper_bound_ms": 1772680000017,
  "causal_parents": ["mac_xyz789-998"]
}
```

## 5. API 契约

## 5.1 `POST /v1/pair/start`
用途：由扩展或桌面 UI 发起配对会话，返回二维码载荷。

请求：
```json
{
  "initiator_device_id": "mac_xyz789",
  "initiator_name": "ChromeMac",
  "requested_by": "extension"
}
```

响应：
```json
{
  "session_id": "pair_01J...",
  "one_time_token": "ptk_...",
  "expires_at_ms": 1772681111000,
  "agent_endpoint": "https://192.168.1.5:8433",
  "agent_pubkey_fingerprint": "SHA256:...."
}
```

错误：
- `PAIR_RATE_LIMITED`
- `PAIR_AGENT_NOT_READY`

## 5.2 `POST /v1/pair/confirm`
用途：APP 扫码后确认配对。

请求：
```json
{
  "session_id": "pair_01J...",
  "one_time_token": "ptk_...",
  "device": {
    "device_id": "ios_abc123",
    "device_name": "iPhone15",
    "platform": "ios",
    "public_key": "BASE64"
  }
}
```

响应：
```json
{
  "session_token": "st_...",
  "expires_at_ms": 1772767511000,
  "peer_device_id": "mac_xyz789"
}
```

错误：
- `PAIR_TOKEN_EXPIRED`
- `PAIR_TOKEN_USED`
- `PAIR_SESSION_NOT_FOUND`
- `PAIR_DEVICE_REVOKED`

## 5.3 `POST /v1/sync/pull`
用途：按客户端已见向量拉取缺失 op。

请求：
```json
{
  "vector_clock": {
    "entries": [
      { "device_id": "ios_abc123", "max_counter": 1203 },
      { "device_id": "mac_xyz789", "max_counter": 998 }
    ]
  },
  "limit": 500
}
```

响应：
```json
{
  "sync_session_id": "sync_01J...",
  "ops": [
    {
      "op_id": "mac_xyz789-999",
      "device_id": "mac_xyz789",
      "device_counter": 999,
      "account_id": "apple.com20260305091530alice",
      "field_name": "note",
      "op_type": "set",
      "value_cipher_b64": "BASE64",
      "value_json": null,
      "hlc_physical_ms": 1772682000000,
      "hlc_logical": 0,
      "event_time_ms_local": 1772681999900,
      "clock_offset_ms": 8,
      "clock_uncertainty_ms": 40,
      "lower_bound_ms": 1772681999852,
      "upper_bound_ms": 1772681999932,
      "causal_parents": []
    }
  ],
  "has_more": false,
  "server_vector_clock": {
    "entries": [
      { "device_id": "ios_abc123", "max_counter": 1203 },
      { "device_id": "mac_xyz789", "max_counter": 999 }
    ]
  }
}
```

错误：
- `SYNC_NOT_PAIRED`
- `SYNC_VECTOR_INVALID`

## 5.4 `POST /v1/sync/push`
用途：客户端提交本地新增 op。

请求：
```json
{
  "sync_session_id": "sync_01J...",
  "ops": [
    {
      "op_id": "ios_abc123-1204",
      "device_id": "ios_abc123",
      "device_counter": 1204,
      "account_id": "apple.com20260305091530alice",
      "field_name": "password",
      "op_type": "set",
      "value_cipher_b64": "BASE64",
      "value_json": null,
      "hlc_physical_ms": 1772680000123,
      "hlc_logical": 2,
      "event_time_ms_local": 1772680000000,
      "clock_offset_ms": -18,
      "clock_uncertainty_ms": 35,
      "lower_bound_ms": 1772679999947,
      "upper_bound_ms": 1772680000017,
      "causal_parents": ["mac_xyz789-998"]
    }
  ]
}
```

响应：
```json
{
  "accepted_op_ids": ["ios_abc123-1204"],
  "duplicated_op_ids": [],
  "rejected": [],
  "conflicts": [
    {
      "account_id": "apple.com20260305091530alice",
      "field_name": "delete_flag",
      "reason": "time_range_overlap_default_undelete",
      "review_required": true
    }
  ],
  "server_vector_clock": {
    "entries": [
      { "device_id": "ios_abc123", "max_counter": 1204 },
      { "device_id": "mac_xyz789", "max_counter": 999 }
    ]
  }
}
```

错误：
- `SYNC_OP_INVALID`
- `SYNC_OP_ACCOUNT_NOT_FOUND`
- `SYNC_OP_SIGNATURE_INVALID`

## 5.5 `POST /v1/sync/merge-preview`
用途：返回冲突预览，不落库（可选）。

请求：
```json
{
  "ops": []
}
```

响应：
```json
{
  "conflicts": []
}
```

## 5.6 `POST /v1/export/csv`
请求：
```json
{
  "include_deleted": false
}
```

响应：
```json
{
  "job_id": "csv_01J...",
  "status": "running"
}
```

## 5.7 `POST /v1/import/csv`
请求：
```json
{
  "file_path": "/tmp/pass-import.csv",
  "mode": "merge"
}
```

响应：
```json
{
  "job_id": "csv_02J...",
  "status": "running"
}
```

## 6. 幂等与一致性
- 幂等键：
  - API 级：`X-Request-Id`
  - 数据级：`op_id`（唯一）
- 重试规则：
  - `5xx` 和网络错误允许重试。
  - `4xx` 仅在可恢复错误码时重试（如 token 过期后重新配对）。
- 一致性要求：
  - 同一批 op 重放任意次，最终状态不变。
  - 向量时钟推进单调递增，不回退。

## 7. 错误码规范

### 7.1 通用
- `UNAUTHORIZED`
- `FORBIDDEN`
- `INVALID_ARGUMENT`
- `TOO_MANY_REQUESTS`
- `INTERNAL_ERROR`

### 7.2 配对
- `PAIR_TOKEN_EXPIRED`
- `PAIR_TOKEN_USED`
- `PAIR_SESSION_NOT_FOUND`
- `PAIR_DEVICE_REVOKED`

### 7.3 同步
- `SYNC_NOT_PAIRED`
- `SYNC_VECTOR_INVALID`
- `SYNC_OP_INVALID`
- `SYNC_OP_ACCOUNT_NOT_FOUND`
- `SYNC_CONFLICT_REVIEW_REQUIRED`

### 7.4 导入导出
- `CSV_FILE_NOT_FOUND`
- `CSV_FORMAT_INVALID`
- `CSV_IMPORT_PARTIAL_FAILED`

## 8. 版本演进
- 协议版本通过 `X-Protocol-Version` 协商。
- 新字段仅追加，不删除既有字段。
- 破坏性变更必须升级主版本（`2`）并提供双栈过渡窗口。

## 9. 最小联调清单
1. 配对成功并拿到 `session_token`。
2. 空库 `pull` 返回空并携带 server vector。
3. 客户端 `push` 一条 `set password` op 并被接收。
4. 第二设备 `pull` 能看到该 op。
5. 重复 `push` 同 `op_id` 返回 duplicated，不改变最终状态。
6. 删除与更新并发时返回 conflict 信息并设置审阅标记。
