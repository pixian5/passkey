# 测试基线与同步端到端约定

## 1. 统一入口

在仓库根目录运行：

```bash
bash scripts/test_all.sh
```

默认不下载依赖，依次运行：

1. 扩展共享层 Node 测试（112 项）
2. Ubuntu 同步服务器和脚本 Python 测试
3. `core/pass_core` 全工作区 Rust 测试
4. JS 与 Rust 合并黄金向量对拍
5. Docker Web 与 Tauri Rust 测试
6. 领域 FFI 对拍、命令矩阵、Markdown 链接检查

Cargo 默认使用临时目录，避免仓库历史 `target` 缓存中的权限或损坏产物影响结果。需要复用缓存时可显式指定：

```bash
CARGO_TARGET_DIR=/tmp/pass-target bash scripts/test_all.sh
```

脚本结尾区分两类失败：

- `代码失败`：命令已运行但测试或构建返回非零，必须修复后再提交。
- `环境不可用`：缺少 Node/Python/Cargo、依赖目录或明确请求的 Docker/Android 工具；不能把这类结果记为通过。

Docker 生命周期测试会构建镜像并清理它创建的临时 Compose 项目，必须显式运行：

```bash
bash scripts/test_all.sh --docker
```

Android 单元测试同样显式运行：

```bash
bash scripts/test_all.sh --android
```

## 2. Cargo 门禁注意事项

`scripts/core_gate.sh` 与 `scripts/check_domain_ffi.sh` 都尊重 `CARGO_TARGET_DIR`。macOS FFI 打包脚本也从该目录读取 dylib；对拍脚本会优先寻找该目录下的 `pass-merge-cli`。因此门禁不会因旧构建脚本不可执行而误报代码失败。

## 3. Python SQLite 资源约定

Python `sqlite3.Connection` 的上下文管理器只提交或回滚事务，不负责关闭连接。只读审计必须使用 `try/finally: connection.close()`，测试夹具也必须显式关闭；资源警告属于测试失败，不得忽略。

## 4. 同步边界测试

自建服务器端到端测试必须覆盖：

- 已有状态缺少 `If-Match` 返回 `428`；
- 过期 `ETag` 返回 `412`，客户端重新拉取、合并再写入；
- 相同 `Idempotency-Key` 重试只重放原响应，不增加 revision；
- 远端写入成功但客户端响应丢失时，补偿重试仍只产生一个版本；
- 临时 `503` 后重试能恢复，且不会重复历史版本；
- 恢复历史版本同时要求当前 `If-Match` 和 `Idempotency-Key`；
- WebDAV 有 ETag 时进行条件写入，无 ETag 的已有远端不能被无条件覆盖。

这些测试验证传输层的并发和耐久性；字段级合并、顺序数组、关系墓碑和永久删除安全性继续由 Rust/JS 黄金向量与共享 Node 测试验证。
