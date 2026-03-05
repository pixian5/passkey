-- 跨平台密码管理器 SQLite/SQLCipher Schema (V1)
-- 时间戳统一使用 UTC epoch milliseconds

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- 设备表
CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('windows', 'macos', 'linux', 'ios', 'android', 'extension')),
  public_key BLOB,
  is_trusted INTEGER NOT NULL DEFAULT 0 CHECK (is_trusted IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'lost')),
  clock_offset_ms INTEGER NOT NULL DEFAULT 0,
  clock_uncertainty_ms INTEGER NOT NULL DEFAULT 60000,
  created_at_ms INTEGER NOT NULL,
  last_seen_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen_at_ms);

-- 域名别名组
CREATE TABLE IF NOT EXISTS alias_groups (
  alias_group_id TEXT PRIMARY KEY,
  domains_json TEXT NOT NULL DEFAULT '[]',      -- 排序、去重后的域名数组
  etld1_set_json TEXT NOT NULL DEFAULT '[]',    -- 组内 eTLD+1 集合
  allow_cross_etld1 INTEGER NOT NULL DEFAULT 0 CHECK (allow_cross_etld1 IN (0, 1)),
  updated_by_device_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (updated_by_device_id) REFERENCES devices(device_id)
);

CREATE INDEX IF NOT EXISTS idx_alias_groups_updated_at ON alias_groups(updated_at_ms);

-- 账号快照表（查询主表）
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,                  -- canonical_site + created_at + username_at_create
  canonical_site TEXT NOT NULL,
  alias_group_id TEXT NOT NULL,
  username_at_create TEXT NOT NULL,             -- 创建时用户名快照，不可变

  username TEXT NOT NULL DEFAULT '',
  password_cipher BLOB NOT NULL DEFAULT X'',
  totp_secret_cipher BLOB NOT NULL DEFAULT X'',
  recovery_codes_cipher BLOB NOT NULL DEFAULT X'',
  note_cipher BLOB NOT NULL DEFAULT X'',
  sites_json TEXT NOT NULL DEFAULT '[]',        -- 供 UI 快速读取，真源是 alias_groups

  username_updated_at_ms INTEGER NOT NULL,
  password_updated_at_ms INTEGER NOT NULL,
  totp_updated_at_ms INTEGER NOT NULL,
  recovery_codes_updated_at_ms INTEGER NOT NULL,
  note_updated_at_ms INTEGER NOT NULL,

  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  deleted_at_ms INTEGER,
  conflict_review INTEGER NOT NULL DEFAULT 0 CHECK (conflict_review IN (0, 1)),

  last_operated_device_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,

  FOREIGN KEY (alias_group_id) REFERENCES alias_groups(alias_group_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (last_operated_device_id) REFERENCES devices(device_id),

  CHECK (
    (is_deleted = 0 AND deleted_at_ms IS NULL) OR
    (is_deleted = 1 AND deleted_at_ms IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_accounts_alias_group ON accounts(alias_group_id);
CREATE INDEX IF NOT EXISTS idx_accounts_canonical_site ON accounts(canonical_site);
CREATE INDEX IF NOT EXISTS idx_accounts_deleted ON accounts(is_deleted, updated_at_ms);
CREATE INDEX IF NOT EXISTS idx_accounts_conflict_review ON accounts(conflict_review, updated_at_ms);

-- 操作日志表（同步真源）
CREATE TABLE IF NOT EXISTS op_logs (
  op_id TEXT PRIMARY KEY,                       -- device_id + counter
  device_id TEXT NOT NULL,
  device_counter INTEGER NOT NULL,
  account_id TEXT NOT NULL,

  field_name TEXT NOT NULL CHECK (
    field_name IN ('username', 'password', 'totp', 'recovery_codes', 'note', 'sites', 'delete_flag')
  ),
  op_type TEXT NOT NULL CHECK (
    op_type IN ('set', 'delete', 'undelete', 'add_alias', 'remove_alias')
  ),

  value_cipher BLOB,                            -- 敏感字段密文
  value_json TEXT,                              -- 非敏感结构化值（如 sites 变更）

  hlc_physical_ms INTEGER NOT NULL,
  hlc_logical INTEGER NOT NULL DEFAULT 0,
  event_time_ms_local INTEGER NOT NULL,
  clock_offset_ms INTEGER NOT NULL,
  clock_uncertainty_ms INTEGER NOT NULL,
  lower_bound_ms INTEGER NOT NULL,
  upper_bound_ms INTEGER NOT NULL,
  causal_parents_json TEXT NOT NULL DEFAULT '[]',

  source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'remote', 'import_csv')),
  created_at_ms INTEGER NOT NULL,
  applied_at_ms INTEGER,

  FOREIGN KEY (device_id) REFERENCES devices(device_id),
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE,
  UNIQUE (device_id, device_counter),
  CHECK (upper_bound_ms >= lower_bound_ms)
);

CREATE INDEX IF NOT EXISTS idx_op_logs_account_field ON op_logs(account_id, field_name);
CREATE INDEX IF NOT EXISTS idx_op_logs_hlc ON op_logs(hlc_physical_ms, hlc_logical);
CREATE INDEX IF NOT EXISTS idx_op_logs_bounds ON op_logs(lower_bound_ms, upper_bound_ms);
CREATE INDEX IF NOT EXISTS idx_op_logs_created_at ON op_logs(created_at_ms);
CREATE INDEX IF NOT EXISTS idx_op_logs_source ON op_logs(source);

-- 各字段“当前胜出操作”缓存，避免每次从日志全量重放
CREATE TABLE IF NOT EXISTS account_field_winners (
  account_id TEXT NOT NULL,
  field_name TEXT NOT NULL CHECK (
    field_name IN ('username', 'password', 'totp', 'recovery_codes', 'note', 'sites', 'delete_flag')
  ),
  winner_op_id TEXT NOT NULL,
  winner_lower_bound_ms INTEGER NOT NULL,
  winner_upper_bound_ms INTEGER NOT NULL,
  winner_hlc_physical_ms INTEGER NOT NULL,
  winner_hlc_logical INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (account_id, field_name),
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE,
  FOREIGN KEY (winner_op_id) REFERENCES op_logs(op_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_field_winners_winner_op ON account_field_winners(winner_op_id);

-- 向量时钟（按对端设备记录已见 counter）
CREATE TABLE IF NOT EXISTS version_vectors (
  peer_device_id TEXT PRIMARY KEY,
  max_counter INTEGER NOT NULL,
  max_hlc_physical_ms INTEGER NOT NULL DEFAULT 0,
  max_hlc_logical INTEGER NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (peer_device_id) REFERENCES devices(device_id) ON DELETE CASCADE
);

-- 同步会话审计
CREATE TABLE IF NOT EXISTS sync_sessions (
  sync_session_id TEXT PRIMARY KEY,
  peer_device_id TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  result TEXT NOT NULL CHECK (result IN ('success', 'partial', 'failed', 'aborted')),
  pull_ops_count INTEGER NOT NULL DEFAULT 0,
  push_ops_count INTEGER NOT NULL DEFAULT 0,
  conflicts_detected INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  FOREIGN KEY (peer_device_id) REFERENCES devices(device_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_sessions_peer ON sync_sessions(peer_device_id, started_at_ms);
CREATE INDEX IF NOT EXISTS idx_sync_sessions_result ON sync_sessions(result, started_at_ms);

-- CSV 导入导出任务审计
CREATE TABLE IF NOT EXISTS csv_jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (job_type IN ('import', 'export')),
  file_path TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  completed_at_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  rows_total INTEGER NOT NULL DEFAULT 0,
  rows_success INTEGER NOT NULL DEFAULT 0,
  rows_failed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_csv_jobs_started ON csv_jobs(started_at_ms);
CREATE INDEX IF NOT EXISTS idx_csv_jobs_status ON csv_jobs(status, started_at_ms);

-- 迁移记录
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at_ms INTEGER NOT NULL
);

-- 初始版本
INSERT OR IGNORE INTO schema_migrations (version, description, applied_at_ms)
VALUES (1, 'initial schema for cross-platform password manager', strftime('%s', 'now') * 1000);
