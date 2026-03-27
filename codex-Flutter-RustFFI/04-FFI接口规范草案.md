# 04 FFI 接口规范草案

> 目标：稳定 C ABI，避免 Dart 与 Rust 类型耦合。

## 1. 版本与生命周期
- `pass_core_version() -> *const c_char`
- `pass_core_init(config_json: *const c_char) -> i32`
- `pass_core_shutdown() -> i32`

## 2. 通用调用协议
- 输入：UTF-8 JSON 字符串（C 字符串）
- 输出：统一 JSON（包含 `code`, `message`, `data`）
- 内存：由 Rust 分配返回字符串，Dart 调用 `pass_core_string_free(ptr)` 释放

## 3. 账号相关 API
- `pass_accounts_list(req_json)`
- `pass_accounts_create(req_json)`
- `pass_accounts_update(req_json)`
- `pass_accounts_delete(req_json)`（软删除）
- `pass_accounts_restore(req_json)`
- `pass_accounts_purge(req_json)`（永久删除）

## 4. 别名与导出 API
- `pass_alias_normalize(req_json)`
- `pass_csv_export(req_json)`
- `pass_csv_import(req_json)`

## 5. 错误码约定
- `0`: success
- `1`: validation failed
- `2`: not found
- `3`: conflict
- `4`: io error
- `5`: internal error

## 6. 兼容策略
- 所有请求都必须包含 `api_version`。
- 新字段仅追加，不做破坏性移除。
