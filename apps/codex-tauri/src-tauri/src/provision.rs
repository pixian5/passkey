//! SSH provision of self-hosted pass-sync-server (parity with PassMac ServerProvisioning).

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use uuid::Uuid;

use crate::local_vault;
use crate::sync::crypto::is_valid_sync_key;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshCredential {
    #[serde(default = "default_user")]
    pub username: String,
    #[serde(default = "default_port")]
    pub port: u16,
    /// "password" | "privateKey"
    #[serde(default = "default_auth")]
    pub auth_mode: String,
    /// Password or private key PEM content.
    #[serde(default)]
    pub secret: String,
    #[serde(default)]
    pub private_key_passphrase: String,
}

fn default_user() -> String {
    "root".into()
}
fn default_port() -> u16 {
    22
}
fn default_auth() -> String {
    "privateKey".into()
}

impl Default for SshCredential {
    fn default() -> Self {
        Self {
            username: default_user(),
            port: default_port(),
            auth_mode: default_auth(),
            secret: String::new(),
            private_key_passphrase: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct CredFile {
    version: u32,
    values: std::collections::BTreeMap<String, SshCredential>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionResult {
    pub host: String,
    pub port: u16,
    pub endpoint: String,
    pub message: String,
    #[serde(default)]
    pub removed_existing: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingServiceReport {
    pub host: String,
    pub endpoint: String,
    pub exists: bool,
    /// Human-readable findings, e.g. unit active / files present.
    pub findings: Vec<String>,
    pub summary: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshHostKeyInspection {
    pub host: String,
    pub port: u16,
    pub already_trusted: bool,
    pub fingerprints: Vec<String>,
    pub key_lines: Vec<String>,
}

const CRED_FILE: &str = "server_ssh_credentials.json";

fn known_hosts_path(data_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(data_dir).map_err(|e| format!("创建 SSH 数据目录失败: {e}"))?;
    let path = data_dir.join("ssh-known-hosts");
    if !path.exists() {
        fs::write(&path, b"").map_err(|e| format!("创建 SSH known_hosts 失败: {e}"))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("设置 SSH known_hosts 权限失败: {e}"))?;
    }
    Ok(path)
}

fn known_host_query(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

fn host_key_lines_match(host: &str, port: u16, key_lines: &[String]) -> bool {
    let query = known_host_query(host, port);
    !key_lines.is_empty()
        && key_lines.iter().all(|line| {
            let host_field = line.split_whitespace().next().unwrap_or_default();
            host_field == query
        })
}

fn ssh_keyscan_bin() -> &'static str {
    if cfg!(windows) {
        "ssh-keyscan"
    } else {
        "/usr/bin/ssh-keyscan"
    }
}

fn ssh_keygen_bin() -> &'static str {
    if cfg!(windows) {
        "ssh-keygen"
    } else {
        "/usr/bin/ssh-keygen"
    }
}

fn host_key_fingerprints(lines: &[String]) -> Result<Vec<String>, String> {
    let temp = std::env::temp_dir().join(format!("pass-host-key-{}", Uuid::new_v4()));
    fs::write(&temp, format!("{}\n", lines.join("\n")))
        .map_err(|e| format!("暂存 SSH 主机公钥失败: {e}"))?;
    let output = Command::new(ssh_keygen_bin())
        .args(["-l", "-E", "sha256", "-f"])
        .arg(&temp)
        .output()
        .map_err(|e| format!("启动 ssh-keygen 失败: {e}"));
    let _ = fs::remove_file(temp);
    let output = output?;
    if !output.status.success() {
        return Err("无法计算 SSH 主机公钥指纹".into());
    }
    let fingerprints = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if fingerprints.is_empty() {
        return Err("服务器未返回可核对的 SSH 主机公钥".into());
    }
    Ok(fingerprints)
}

pub fn inspect_ssh_host_key(
    data_dir: &Path,
    server_url: &str,
    port: u16,
) -> Result<SshHostKeyInspection, String> {
    let endpoint = parse_endpoint(server_url)?;
    let known_hosts = known_hosts_path(data_dir)?;
    let query = known_host_query(&endpoint.host, port);
    let trusted = Command::new(ssh_keygen_bin())
        .args(["-F", &query, "-f"])
        .arg(&known_hosts)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false);
    if trusted {
        return Ok(SshHostKeyInspection {
            host: endpoint.host,
            port,
            already_trusted: true,
            fingerprints: Vec::new(),
            key_lines: Vec::new(),
        });
    }
    let output = Command::new(ssh_keyscan_bin())
        .args(["-T", "10", "-p", &port.to_string(), &endpoint.host])
        .output()
        .map_err(|e| format!("启动 ssh-keyscan 失败: {e}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        return Err(format!("读取 SSH 主机公钥失败: {}", detail.trim()));
    }
    let key_lines = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_string)
        .collect::<Vec<_>>();
    let fingerprints = host_key_fingerprints(&key_lines)?;
    Ok(SshHostKeyInspection {
        host: endpoint.host,
        port,
        already_trusted: false,
        fingerprints,
        key_lines,
    })
}

pub fn trust_ssh_host_key(
    data_dir: &Path,
    server_url: &str,
    port: u16,
    key_lines: Vec<String>,
) -> Result<(), String> {
    let endpoint = parse_endpoint(server_url)?;
    if !host_key_lines_match(&endpoint.host, port, &key_lines) {
        return Err("待信任的 SSH 主机公钥与服务器地址不一致".into());
    }
    host_key_fingerprints(&key_lines)?;
    let path = known_hosts_path(data_dir)?;
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .map_err(|e| format!("打开 SSH known_hosts 失败: {e}"))?;
    file.write_all(format!("{}\n", key_lines.join("\n")).as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("保存 SSH 主机公钥失败: {e}"))?;
    fs::File::open(data_dir)
        .and_then(|directory| directory.sync_all())
        .map_err(|e| format!("持久化 SSH 主机公钥失败: {e}"))
}

pub fn load_ssh_credential(data_dir: &Path, host: &str) -> Option<SshCredential> {
    let path = data_dir.join(CRED_FILE);
    let raw = local_vault::read_text(data_dir, &path, "pass.tauri.ssh_credentials.v1")
        .ok()
        .flatten()?;
    let file: CredFile = serde_json::from_str(&raw).ok()?;
    file.values.get(&normalize_host(host)).cloned()
}

pub fn save_ssh_credential(
    data_dir: &Path,
    host: &str,
    cred: &SshCredential,
) -> Result<(), String> {
    let path = data_dir.join(CRED_FILE);
    let mut file: CredFile =
        local_vault::read_text(data_dir, &path, "pass.tauri.ssh_credentials.v1")
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(CredFile {
                version: 1,
                values: Default::default(),
            });
    file.version = 1;
    file.values.insert(normalize_host(host), cred.clone());
    let raw = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
    local_vault::write_text(data_dir, &path, "pass.tauri.ssh_credentials.v1", &raw)
}

fn normalize_host(host: &str) -> String {
    host.trim().to_ascii_lowercase()
}

struct Endpoint {
    host: String,
    endpoint: String,
    backend_port: u16,
    uses_tls: bool,
}

fn parse_endpoint(raw: &str) -> Result<Endpoint, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("服务器地址必须是 HTTPS URL".into());
    }
    let lower = trimmed.to_ascii_lowercase();
    if !lower.starts_with("https://") {
        return Err("服务器地址必须是 HTTPS URL，并包含有效主机名".into());
    }
    let url = url::Url::parse(trimmed).map_err(|_| "服务器地址无效".to_string())?;
    if url.scheme() != "https" {
        return Err("服务器地址必须是 HTTPS URL".into());
    }
    let host = url
        .host_str()
        .filter(|h| !h.is_empty())
        .ok_or_else(|| "服务器地址必须包含有效主机名".to_string())?
        .to_string();
    if url.username() != "" || url.password().is_some() {
        return Err("服务器 URL 不要包含用户名或密码".into());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("服务器 URL 不要包含查询参数".into());
    }
    let path = url.path();
    if !(path.is_empty() || path == "/") {
        return Err("服务器 URL 不要包含路径".into());
    }
    let explicit_port = url.port();
    let backend_port = explicit_port.unwrap_or(53333);
    if backend_port == 0 {
        return Err("端口无效".into());
    }
    let rendered_host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.clone()
    };
    let endpoint = match explicit_port {
        Some(p) => format!("https://{rendered_host}:{p}"),
        None => format!("https://{rendered_host}"),
    };
    Ok(Endpoint {
        host,
        endpoint,
        backend_port,
        uses_tls: explicit_port.is_some(),
    })
}

struct TempSsh {
    dir: PathBuf,
    key: Option<PathBuf>,
    askpass: Option<PathBuf>,
    password_file: Option<PathBuf>,
    known_hosts: PathBuf,
}

impl Drop for TempSsh {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn make_temp_ssh(data_dir: &Path, cred: &SshCredential) -> Result<TempSsh, String> {
    let dir = std::env::temp_dir().join(format!("pass-tauri-ssh-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }

    let known_hosts = known_hosts_path(data_dir)?;

    let mut key = None;
    if cred.auth_mode == "privateKey" {
        let path = dir.join("id_key");
        let pem = cred.secret.replace("\r\n", "\n");
        fs::write(&path, pem).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
        }
        key = Some(path);
    }

    let mut askpass = None;
    let mut password_file = None;
    if cred.auth_mode == "password" || !cred.private_key_passphrase.trim().is_empty() {
        let secret = if cred.auth_mode == "password" {
            cred.secret.as_str()
        } else {
            cred.private_key_passphrase.as_str()
        };
        let value_path = dir.join("askpass-value");
        fs::write(&value_path, secret).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&value_path, fs::Permissions::from_mode(0o600));
        }
        let script_path = dir.join("askpass.sh");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::write(
                &script_path,
                "#!/bin/sh\n/bin/cat \"$PASS_TAURI_SSH_PASSWORD_FILE\"\n",
            )
            .map_err(|e| e.to_string())?;
            let _ = fs::set_permissions(&script_path, fs::Permissions::from_mode(0o700));
        }
        #[cfg(not(unix))]
        {
            return Err("当前平台暂不支持密码式 SSH 创建服务，请使用私钥".into());
        }
        askpass = Some(script_path);
        password_file = Some(value_path);
    }

    Ok(TempSsh {
        dir,
        key,
        askpass,
        password_file,
        known_hosts,
    })
}

fn ssh_bin() -> &'static str {
    if cfg!(windows) {
        "ssh"
    } else {
        "/usr/bin/ssh"
    }
}

fn scp_bin() -> &'static str {
    if cfg!(windows) {
        "scp"
    } else {
        "/usr/bin/scp"
    }
}

fn base_ssh_args(cred: &SshCredential, temp: &TempSsh) -> Vec<String> {
    let mut args = vec![
        "-p".into(),
        cred.port.to_string(),
        "-o".into(),
        "BatchMode=no".into(),
        "-o".into(),
        "NumberOfPasswordPrompts=1".into(),
        "-o".into(),
        "ConnectTimeout=15".into(),
        "-o".into(),
        "ServerAliveInterval=15".into(),
        "-o".into(),
        "ServerAliveCountMax=2".into(),
        "-o".into(),
        "StrictHostKeyChecking=yes".into(),
        "-o".into(),
        "LogLevel=ERROR".into(),
        "-o".into(),
        format!("UserKnownHostsFile={}", temp.known_hosts.display()),
    ];
    if let Some(ref key) = temp.key {
        args.extend([
            "-i".into(),
            key.display().to_string(),
            "-o".into(),
            "IdentitiesOnly=yes".into(),
            "-o".into(),
            "PasswordAuthentication=no".into(),
        ]);
    } else {
        args.extend(["-o".into(), "PubkeyAuthentication=no".into()]);
    }
    args
}

fn ssh_env(temp: &TempSsh) -> Vec<(String, String)> {
    let mut env = vec![];
    if let (Some(ask), Some(pw)) = (&temp.askpass, &temp.password_file) {
        env.push(("SSH_ASKPASS".into(), ask.display().to_string()));
        env.push(("SSH_ASKPASS_REQUIRE".into(), "force".into()));
        env.push(("DISPLAY".into(), ":0".into()));
        env.push((
            "PASS_TAURI_SSH_PASSWORD_FILE".into(),
            pw.display().to_string(),
        ));
    }
    env
}

fn run_process(
    exe: &str,
    args: &[String],
    env: &[(String, String)],
    stdin_data: Option<&[u8]>,
) -> Result<String, String> {
    let mut cmd = Command::new(exe);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if stdin_data.is_some() {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }
    for (k, v) in env {
        cmd.env(k, v);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 {exe} 失败: {e}（请确认已安装 OpenSSH 客户端）"))?;
    if let Some(data) = stdin_data {
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(data)
                .map_err(|e| format!("写入 stdin 失败: {e}"))?;
        }
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("等待 {exe} 失败: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let out = String::from_utf8_lossy(&output.stdout);
        let detail = if err.trim().is_empty() {
            out.trim()
        } else {
            err.trim()
        };
        let short: String = detail.chars().take(400).collect();
        return Err(format!("SSH 操作失败：{short}"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn ssh_host(endpoint: &Endpoint) -> String {
    if endpoint.host.contains(':') {
        format!("[{}]", endpoint.host)
    } else {
        endpoint.host.clone()
    }
}

fn remote_target(cred: &SshCredential, endpoint: &Endpoint) -> String {
    format!("{}@{}", cred.username.trim(), ssh_host(endpoint))
}

/// Quote one value for the POSIX shell executed by the remote OpenSSH server.
/// Certificate paths originate from the settings form, so they must never be
/// interpolated into a remote command without escaping embedded apostrophes.
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn ssh_run(
    cred: &SshCredential,
    endpoint: &Endpoint,
    temp: &TempSsh,
    remote_cmd: &str,
) -> Result<String, String> {
    let mut args = base_ssh_args(cred, temp);
    args.push(remote_target(cred, endpoint));
    args.push(remote_cmd.to_string());
    let env = ssh_env(temp);
    run_process(ssh_bin(), &args, &env, None)
}

fn scp_file(
    cred: &SshCredential,
    endpoint: &Endpoint,
    temp: &TempSsh,
    local: &Path,
    remote_path: &str,
) -> Result<(), String> {
    let mut args = base_ssh_args(cred, temp);
    // scp uses -P for port
    if let Some(i) = args.iter().position(|a| a == "-p") {
        args[i] = "-P".into();
    }
    args.push(local.display().to_string());
    args.push(format!("{}:{}", remote_target(cred, endpoint), remote_path));
    let env = ssh_env(temp);
    run_process(scp_bin(), &args, &env, None)?;
    Ok(())
}

fn ssh_write(
    cred: &SshCredential,
    endpoint: &Endpoint,
    temp: &TempSsh,
    remote_path: &str,
    data: &[u8],
    mode: &str,
) -> Result<(), String> {
    let remote_path = shell_quote(remote_path);
    let remote_cmd = format!("umask 077; cat > {remote_path}; chmod {mode} {remote_path}");
    let mut args = base_ssh_args(cred, temp);
    args.push(remote_target(cred, endpoint));
    args.push(remote_cmd);
    let env = ssh_env(temp);
    run_process(ssh_bin(), &args, &env, Some(data))?;
    Ok(())
}

fn ssh_file_exists(
    cred: &SshCredential,
    endpoint: &Endpoint,
    temp: &TempSsh,
    path: &str,
) -> Result<bool, String> {
    match ssh_run(
        cred,
        endpoint,
        temp,
        &format!("test -r {}", shell_quote(path)),
    ) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// 判断输入是否为 PEM 内容（而非远端路径）。
/// PEM 内容必定包含 "-----BEGIN"；路径则不会。
fn is_pem_content(s: &str) -> bool {
    s.contains("-----BEGIN")
}

/// 通过 SSH `cp` 将远端文件复制到另一个远端路径。
fn ssh_cp_remote(
    cred: &SshCredential,
    endpoint: &Endpoint,
    temp: &TempSsh,
    src: &str,
    dst: &str,
    mode: &str,
) -> Result<(), String> {
    let src = shell_quote(src);
    let dst = shell_quote(dst);
    let cmd = format!("cp -- {src} {dst} && chmod {mode} {dst}", mode = mode);
    ssh_run(cred, endpoint, temp, &cmd).map(|_| ())
}

fn service_text(endpoint: &Endpoint) -> String {
    let mut lines = vec![
        "[Unit]".into(),
        "Description=Pass Sync Server".into(),
        "After=network.target".into(),
        "".into(),
        "[Service]".into(),
        "Type=simple".into(),
        "User=pass".into(),
        "Group=pass".into(),
        "UMask=0077".into(),
        "WorkingDirectory=/opt/pass-sync-server".into(),
        format!(
            "Environment=PASS_SYNC_HOST={}",
            if endpoint.uses_tls {
                "0.0.0.0"
            } else {
                "127.0.0.1"
            }
        ),
        format!("Environment=PASS_SYNC_PORT={}", endpoint.backend_port),
        "Environment=PASS_SYNC_DB_PATH=/var/lib/pass-sync/pass_sync.sqlite3".into(),
        "Environment=PASS_SYNC_BEARER_TOKENS_FILE=/etc/pass-sync/tokens.conf".into(),
        "EnvironmentFile=-/etc/pass-sync/pass-sync-server.env".into(),
        "Environment=PASS_SYNC_LOG_LEVEL=INFO".into(),
        "Environment=PASS_SYNC_RATE_LIMIT_PER_MINUTE=120".into(),
        "Environment=PASS_SYNC_CLIENT_TIMEOUT_SECONDS=15".into(),
        "Environment=PASS_SYNC_MAX_CONCURRENT_REQUESTS=32".into(),
    ];
    if endpoint.uses_tls {
        lines.push("Environment=PASS_SYNC_TLS_CERT=/etc/pass-sync/tls/server.crt".into());
        lines.push("Environment=PASS_SYNC_TLS_KEY=/etc/pass-sync/tls/server.key".into());
    }
    lines.extend([
        "ExecStart=/usr/bin/python3 /opt/pass-sync-server/pass_sync_server.py".into(),
        "Restart=always".into(),
        "RestartSec=2".into(),
        "".into(),
        "[Install]".into(),
        "WantedBy=multi-user.target".into(),
        "".into(),
    ]);
    lines.join("\n")
}

const BACKUP_SERVICE: &str = r#"[Unit]
Description=Backup Pass Sync Server database
After=pass-sync-server.service

[Service]
Type=oneshot
User=root
UMask=0077
ExecStart=/opt/pass-sync-server/backup_sync_db.sh
"#;

const BACKUP_TIMER: &str = r#"[Unit]
Description=Daily Pass Sync Server database backup

[Timer]
OnCalendar=*-*-* 03:20:00
Persistent=true
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
"#;

fn environment_text(sync_encryption_key: &str) -> String {
    let configured = !sync_encryption_key.trim().is_empty();
    format!(
        "# 由 PassDesktop「在服务器创建服务」生成\nPASS_SYNC_ALLOW_PLAINTEXT={}\n",
        if configured { "0" } else { "1" }
    )
}

/// Preferred TLS certificate sources on the remote host (checked in order).
/// Service always consumes copies under `/etc/pass-sync/tls/`.
const TLS_SOURCE_CANDIDATES: &[&str] = &[
    // acme.sh ECC issue for sbbz.tech (user-provided live path)
    "/root/.acme.sh/sbbz.tech_ecc",
    // acme.sh RSA / alternate layout
    "/root/.acme.sh/sbbz.tech",
    // legacy fixed paths used by older deploy scripts
    "/etc/bz/certs",
];

/// Shell snippet: resolve remote cert/key into CERT_SRC / KEY_SRC, or exit with error.
fn tls_resolve_shell() -> &'static str {
    r#"
CERT_SRC=""
KEY_SRC=""
# Prefer fullchain + private key names used by acme.sh / Let's Encrypt.
for dir in \
  '/root/.acme.sh/sbbz.tech_ecc' \
  '/root/.acme.sh/sbbz.tech' \
  '/etc/bz/certs'
do
  if [ -z "$CERT_SRC" ]; then
    for c in \
      "$dir/fullchain.cer" \
      "$dir/fullchain.pem" \
      "$dir/sbbz.tech.cer" \
      "$dir/server.crt" \
      "$dir/cert.pem"
    do
      if [ -f "$c" ]; then CERT_SRC="$c"; break; fi
    done
  fi
  if [ -z "$KEY_SRC" ]; then
    for k in \
      "$dir/sbbz.tech.key" \
      "$dir/server.key" \
      "$dir/privkey.pem" \
      "$dir/private.key"
    do
      if [ -f "$k" ]; then KEY_SRC="$k"; break; fi
    done
  fi
  if [ -n "$CERT_SRC" ] && [ -n "$KEY_SRC" ]; then
    break
  fi
  # Incomplete pair in this dir — keep looking.
  CERT_SRC=""
  KEY_SRC=""
done
if [ -z "$CERT_SRC" ] || [ -z "$KEY_SRC" ]; then
  echo "未找到可用的 TLS 证书/私钥。已检查: /root/.acme.sh/sbbz.tech_ecc、/root/.acme.sh/sbbz.tech、/etc/bz/certs" >&2
  exit 1
fi
"#
}

fn install_command(stage: &str, endpoint: &Endpoint, custom_tls: bool) -> String {
    let tls = if endpoint.uses_tls { "1" } else { "0" };
    let port = endpoint.backend_port;
    let health_host = endpoint.host.as_str();
    let tls_resolve = if custom_tls {
        format!(
            "CERT_SRC='{stage}/fullchain.cer'\nKEY_SRC='{stage}/sbbz.tech.key'",
            stage = stage
        )
    } else {
        tls_resolve_shell().to_string()
    };
    format!(
        r#"
set -eu
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo -n"; fi
$SUDO sh -c 'getent group pass >/dev/null 2>&1 || groupadd --system pass'
$SUDO sh -c 'id -u pass >/dev/null 2>&1 || useradd --system --gid pass --home-dir /nonexistent --shell /usr/sbin/nologin pass'
$SUDO install -d -m 0755 /opt/pass-sync-server /etc/pass-sync
$SUDO install -d -m 0700 -o pass -g pass /var/lib/pass-sync /var/lib/pass-sync/backups
if [ -f /var/lib/pass-sync/pass_sync.sqlite3 ]; then
  stamp=$(date +%Y%m%d-%H%M%S)
  $SUDO install -d -m 0700 -o pass -g pass "/var/lib/pass-sync/backups/$stamp-pre-provision"
  if command -v sqlite3 >/dev/null 2>&1; then
    $SUDO sqlite3 /var/lib/pass-sync/pass_sync.sqlite3 ".backup '/var/lib/pass-sync/backups/$stamp-pre-provision/pass_sync.sqlite3'"
  else
    $SUDO cp -a /var/lib/pass-sync/pass_sync.sqlite3 "/var/lib/pass-sync/backups/$stamp-pre-provision/pass_sync.sqlite3"
  fi
fi
$SUDO install -m 0644 '{stage}/pass_sync_server.py' /opt/pass-sync-server/pass_sync_server.py
$SUDO install -m 0755 '{stage}/backup_sync_db.sh' /opt/pass-sync-server/backup_sync_db.sh
$SUDO install -m 0600 '{stage}/tokens.conf' /etc/pass-sync/tokens.conf
$SUDO chown pass:pass /etc/pass-sync/tokens.conf
$SUDO install -m 0600 '{stage}/pass-sync-server.env' /etc/pass-sync/pass-sync-server.env
$SUDO chown root:root /etc/pass-sync/pass-sync-server.env
if [ "{tls}" = "1" ]; then
{tls_resolve}
  $SUDO install -d -m 0750 -o pass -g pass /etc/pass-sync/tls
  $SUDO install -m 0644 -o pass -g pass "$CERT_SRC" /etc/pass-sync/tls/server.crt
  $SUDO install -m 0600 -o pass -g pass "$KEY_SRC" /etc/pass-sync/tls/server.key
fi
$SUDO install -m 0644 '{stage}/pass-sync-server.service' /etc/systemd/system/pass-sync-server.service
$SUDO install -m 0644 '{stage}/pass-sync-server-backup.service' /etc/systemd/system/pass-sync-server-backup.service
$SUDO install -m 0644 '{stage}/pass-sync-server-backup.timer' /etc/systemd/system/pass-sync-server-backup.timer
$SUDO chown -R pass:pass /var/lib/pass-sync
$SUDO systemctl daemon-reload
$SUDO systemctl enable pass-sync-server pass-sync-server-backup.timer >/dev/null
$SUDO systemctl restart pass-sync-server
$SUDO systemctl enable --now pass-sync-server-backup.timer >/dev/null
if [ "{tls}" = "1" ]; then
  if command -v ufw >/dev/null 2>&1 && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
    $SUDO ufw allow {port}/tcp >/dev/null
  fi
  healthy=0
  for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 15 --resolve '{health_host}:{port}:127.0.0.1' https://{health_host}:{port}/healthz >/dev/null; then
      healthy=1
      break
    fi
    sleep 1
  done
else
  healthy=0
  for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 15 http://127.0.0.1:{port}/healthz >/dev/null; then
      healthy=1
      break
    fi
    sleep 1
  done
fi
if [ "$healthy" -ne 1 ]; then
  echo "同步服务启动后健康检查失败" >&2
  exit 1
fi
rm -rf '{stage}'
"#,
        stage = stage,
        tls = tls,
        port = port,
        health_host = health_host,
        tls_resolve = tls_resolve,
    )
}

fn resource_path(name: &str) -> Result<PathBuf, String> {
    // Prefer bundled resource next to executable / resource dir.
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("resources").join(name));
            candidates.push(dir.join("../Resources/resources").join(name));
            candidates.push(dir.join("../Resources").join(name));
            // macOS .app Contents/MacOS -> Contents/Resources
            candidates.push(dir.join("../Resources/resources").join(name));
        }
    }
    // Dev: relative to CARGO_MANIFEST_DIR
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(name),
    );
    // Workspace sibling
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../sync_server_ubuntu")
            .join(name),
    );
    for c in candidates {
        if c.is_file() {
            return Ok(c);
        }
    }
    Err(format!("未找到同步服务资源文件：{name}"))
}

pub fn verify_public_endpoint(endpoint: &str) -> bool {
    let url = format!("{}/healthz", endpoint.trim().trim_end_matches('/'));
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    match client.get(&url).send() {
        Ok(r) => r.status().is_success(),
        Err(_) => false,
    }
}

/// Remote shell that prints one finding per line (path or unit=state).
fn detect_existing_command() -> &'static str {
    r#"
set -eu
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo -n"; fi
found=0
if $SUDO test -f /etc/systemd/system/pass-sync-server.service 2>/dev/null; then
  echo "unit_file=/etc/systemd/system/pass-sync-server.service"
  found=1
fi
if $SUDO test -f /opt/pass-sync-server/pass_sync_server.py 2>/dev/null; then
  echo "app=/opt/pass-sync-server/pass_sync_server.py"
  found=1
fi
if $SUDO test -f /var/lib/pass-sync/pass_sync.sqlite3 2>/dev/null; then
  echo "db=/var/lib/pass-sync/pass_sync.sqlite3"
  found=1
fi
if $SUDO test -f /etc/pass-sync/tokens.conf 2>/dev/null; then
  echo "tokens=/etc/pass-sync/tokens.conf"
  found=1
fi
if command -v systemctl >/dev/null 2>&1; then
  state=$($SUDO systemctl is-active pass-sync-server 2>/dev/null || true)
  enabled=$($SUDO systemctl is-enabled pass-sync-server 2>/dev/null || true)
  if [ -n "$state" ] && [ "$state" != "inactive" ] && [ "$state" != "unknown" ] && [ "$state" != "not-found" ]; then
    echo "service_state=$state"
    found=1
  fi
  if [ "$enabled" = "enabled" ] || [ "$enabled" = "enabled-runtime" ]; then
    echo "service_enabled=$enabled"
    found=1
  fi
fi
if [ "$found" -eq 0 ]; then
  echo "none"
fi
"#
}

fn remove_existing_command() -> &'static str {
    r#"
set -eu
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo -n"; fi
if command -v systemctl >/dev/null 2>&1; then
  $SUDO systemctl stop pass-sync-server 2>/dev/null || true
  $SUDO systemctl stop pass-sync-server-backup.timer 2>/dev/null || true
  $SUDO systemctl stop pass-sync-server-backup.service 2>/dev/null || true
  $SUDO systemctl disable pass-sync-server pass-sync-server-backup.timer 2>/dev/null || true
  $SUDO systemctl disable pass-sync-server-backup.service 2>/dev/null || true
fi
$SUDO rm -f /etc/systemd/system/pass-sync-server.service \
  /etc/systemd/system/pass-sync-server-backup.service \
  /etc/systemd/system/pass-sync-server-backup.timer 2>/dev/null || true
if command -v systemctl >/dev/null 2>&1; then
  $SUDO systemctl daemon-reload 2>/dev/null || true
  $SUDO systemctl reset-failed pass-sync-server 2>/dev/null || true
fi
$SUDO rm -rf /opt/pass-sync-server 2>/dev/null || true
# Keep /var/lib/pass-sync data; reinstall will backup DB again.
$SUDO rm -f /etc/pass-sync/tokens.conf /etc/pass-sync/pass-sync-server.env 2>/dev/null || true
$SUDO rm -rf /etc/pass-sync/tls 2>/dev/null || true
echo "removed"
"#
}

fn findings_from_detect_output(raw: &str) -> (bool, Vec<String>) {
    let mut findings = Vec::new();
    let mut exists = false;
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || line == "none" {
            continue;
        }
        exists = true;
        let pretty = if let Some(rest) = line.strip_prefix("unit_file=") {
            format!("已安装 systemd 单元：{rest}")
        } else if let Some(rest) = line.strip_prefix("app=") {
            format!("已安装程序文件：{rest}")
        } else if let Some(rest) = line.strip_prefix("db=") {
            format!("已有同步数据库：{rest}")
        } else if let Some(rest) = line.strip_prefix("tokens=") {
            format!("已有令牌配置：{rest}")
        } else if let Some(rest) = line.strip_prefix("service_state=") {
            format!("服务状态：{rest}")
        } else if let Some(rest) = line.strip_prefix("service_enabled=") {
            format!("开机自启：{rest}")
        } else {
            line.to_string()
        };
        findings.push(pretty);
    }
    (exists, findings)
}

/// Probe remote host for an existing pass-sync-server installation (SSH only, no install).
pub fn detect_existing_service(
    data_dir: &Path,
    server_url: &str,
    credential: &SshCredential,
) -> Result<ExistingServiceReport, String> {
    let endpoint = parse_endpoint(server_url)?;
    if credential.username.trim().is_empty() || credential.secret.trim().is_empty() {
        return Err("请填写 SSH 密码或私钥".into());
    }
    if credential.port == 0 {
        return Err("SSH 端口必须是 1 到 65535 之间的数字".into());
    }
    let temp = make_temp_ssh(data_dir, credential)?;
    let out = ssh_run(credential, &endpoint, &temp, detect_existing_command())?;
    let (exists, findings) = findings_from_detect_output(&out);
    let summary = if exists {
        format!(
            "检测到服务器 {} 上已有 Pass 同步服务（{} 项）",
            endpoint.host,
            findings.len()
        )
    } else {
        format!("服务器 {} 上未发现已安装的 Pass 同步服务", endpoint.host)
    };
    Ok(ExistingServiceReport {
        host: endpoint.host,
        endpoint: endpoint.endpoint,
        exists,
        findings,
        summary,
    })
}

#[allow(clippy::too_many_arguments)] // Provisioning inputs map directly to the settings UI contract.
pub fn provision_server(
    data_dir: &Path,
    server_url: &str,
    credential: SshCredential,
    access_token: &str,
    sync_encryption_key: &str,
    tls_certificate: &str,
    tls_private_key: &str,
    remove_existing: bool,
) -> Result<ProvisionResult, String> {
    let endpoint = parse_endpoint(server_url)?;
    let token = access_token.trim();
    let tls_certificate = tls_certificate.trim();
    let tls_private_key = tls_private_key.trim();
    let custom_tls = !tls_certificate.is_empty() || !tls_private_key.is_empty();
    // Token is optional: empty means provision an open server (no bearer auth).
    if token.contains(',') || token.contains('\n') || token.contains('\r') {
        return Err("访问令牌不能包含逗号、换行或回车".into());
    }
    // Empty encryption key is plaintext mode; non-empty must be a valid 256-bit key.
    if !is_valid_sync_key(sync_encryption_key) {
        return Err("同步加密密钥无效，必须是 256 位密钥；留空表示明文同步".into());
    }
    if credential.username.trim().is_empty() || credential.secret.trim().is_empty() {
        return Err("请填写 SSH 密码或私钥".into());
    }
    if credential.port == 0 {
        return Err("SSH 端口必须是 1 到 65535 之间的数字".into());
    }

    let server_py = resource_path("pass_sync_server.py")?;
    let backup_sh = resource_path("backup_sync_db.sh")?;
    let temp = make_temp_ssh(data_dir, &credential)?;

    if endpoint.uses_tls {
        if tls_certificate.is_empty() != tls_private_key.is_empty() {
            return Err("SSL 证书和 SSL 私钥必须同时填写，或同时留空".into());
        }
        if custom_tls {
            // 支持两种输入：PEM 内容（含 -----BEGIN）或服务器绝对路径。
            if !is_pem_content(tls_certificate) {
                if !tls_certificate.starts_with('/') {
                    return Err("SSL 证书需为 PEM 内容或服务器绝对路径（以 / 开头）".into());
                }
                if !ssh_file_exists(&credential, &endpoint, &temp, tls_certificate)? {
                    return Err(format!("SSL 证书路径不存在：{}", tls_certificate));
                }
            } else if !tls_certificate.contains("BEGIN CERTIFICATE") {
                return Err("SSL 证书内容无效，请粘贴 fullchain.cer 的 PEM 内容".into());
            }
            if !is_pem_content(tls_private_key) {
                if !tls_private_key.starts_with('/') {
                    return Err("SSL 私钥需为 PEM 内容或服务器绝对路径（以 / 开头）".into());
                }
                if !ssh_file_exists(&credential, &endpoint, &temp, tls_private_key)? {
                    return Err(format!("SSL 私钥路径不存在：{}", tls_private_key));
                }
            } else if !tls_private_key.contains("PRIVATE KEY") {
                return Err("SSL 私钥内容无效，请粘贴 sbbz.tech.key 的 PEM 内容".into());
            }
        }
    } else if custom_tls {
        return Err("只有 HTTPS 显式端口服务才需要填写 SSL 证书".into());
    }

    if endpoint.uses_tls && !custom_tls {
        // Probe preferred certificate locations (acme.sh first, then legacy).
        let mut found = false;
        let mut last_hint = String::new();
        for dir in TLS_SOURCE_CANDIDATES {
            let cert_names = [
                "fullchain.cer",
                "fullchain.pem",
                "sbbz.tech.cer",
                "server.crt",
                "cert.pem",
            ];
            let key_names = ["sbbz.tech.key", "server.key", "privkey.pem", "private.key"];
            let mut has_cert = false;
            let mut has_key = false;
            for name in cert_names {
                let path = format!("{dir}/{name}");
                if ssh_file_exists(&credential, &endpoint, &temp, &path)? {
                    has_cert = true;
                    break;
                }
            }
            for name in key_names {
                let path = format!("{dir}/{name}");
                if ssh_file_exists(&credential, &endpoint, &temp, &path)? {
                    has_key = true;
                    break;
                }
            }
            if has_cert && has_key {
                found = true;
                break;
            }
            if has_cert || has_key {
                last_hint = format!("{dir} 下证书/私钥不完整");
            }
        }
        if !found {
            return Err(format!(
                "服务器 URL 使用了 HTTPS，但未找到可用 TLS 证书。请确认至少一处完整：{}。{}",
                TLS_SOURCE_CANDIDATES.join("、"),
                last_hint
            ));
        }
    }

    let detect_out = ssh_run(&credential, &endpoint, &temp, detect_existing_command())?;
    let (exists, findings) = findings_from_detect_output(&detect_out);
    if exists && !remove_existing {
        return Err(format!(
            "EXISTING_SERVICE:{}|{}",
            endpoint.host,
            findings.join("；")
        ));
    }

    let mut removed_existing = false;
    if exists && remove_existing {
        ssh_run(&credential, &endpoint, &temp, remove_existing_command())?;
        removed_existing = true;
    }

    let stage = format!("/tmp/pass-sync-provision-{}", Uuid::new_v4());
    ssh_run(
        &credential,
        &endpoint,
        &temp,
        &format!("mkdir -p '{stage}'"),
    )?;

    let cleanup = || {
        let _ = ssh_run(&credential, &endpoint, &temp, &format!("rm -rf '{stage}'"));
    };

    if let Err(e) = scp_file(
        &credential,
        &endpoint,
        &temp,
        &server_py,
        &format!("{stage}/pass_sync_server.py"),
    ) {
        cleanup();
        return Err(e);
    }
    if let Err(e) = scp_file(
        &credential,
        &endpoint,
        &temp,
        &backup_sh,
        &format!("{stage}/backup_sync_db.sh"),
    ) {
        cleanup();
        return Err(e);
    }

    let tokens = if token.is_empty() {
        String::new()
    } else {
        format!("default={token}\n")
    };
    if let Err(e) = ssh_write(
        &credential,
        &endpoint,
        &temp,
        &format!("{stage}/tokens.conf"),
        tokens.as_bytes(),
        "0600",
    ) {
        cleanup();
        return Err(e);
    }
    if let Err(e) = ssh_write(
        &credential,
        &endpoint,
        &temp,
        &format!("{stage}/pass-sync-server.service"),
        service_text(&endpoint).as_bytes(),
        "0644",
    ) {
        cleanup();
        return Err(e);
    }
    if let Err(e) = ssh_write(
        &credential,
        &endpoint,
        &temp,
        &format!("{stage}/pass-sync-server-backup.service"),
        BACKUP_SERVICE.as_bytes(),
        "0644",
    ) {
        cleanup();
        return Err(e);
    }
    if let Err(e) = ssh_write(
        &credential,
        &endpoint,
        &temp,
        &format!("{stage}/pass-sync-server-backup.timer"),
        BACKUP_TIMER.as_bytes(),
        "0644",
    ) {
        cleanup();
        return Err(e);
    }
    if let Err(e) = ssh_write(
        &credential,
        &endpoint,
        &temp,
        &format!("{stage}/pass-sync-server.env"),
        environment_text(sync_encryption_key).as_bytes(),
        "0600",
    ) {
        cleanup();
        return Err(e);
    }
    if custom_tls {
        // 路径用 SSH cp 远端复制；PEM 内容直接写入 stage。
        if is_pem_content(tls_certificate) {
            if let Err(e) = ssh_write(
                &credential,
                &endpoint,
                &temp,
                &format!("{stage}/fullchain.cer"),
                tls_certificate.as_bytes(),
                "0644",
            ) {
                cleanup();
                return Err(e);
            }
        } else if let Err(e) = ssh_cp_remote(
            &credential,
            &endpoint,
            &temp,
            tls_certificate,
            &format!("{stage}/fullchain.cer"),
            "0644",
        ) {
            cleanup();
            return Err(e);
        }
        if is_pem_content(tls_private_key) {
            if let Err(e) = ssh_write(
                &credential,
                &endpoint,
                &temp,
                &format!("{stage}/sbbz.tech.key"),
                tls_private_key.as_bytes(),
                "0600",
            ) {
                cleanup();
                return Err(e);
            }
        } else if let Err(e) = ssh_cp_remote(
            &credential,
            &endpoint,
            &temp,
            tls_private_key,
            &format!("{stage}/sbbz.tech.key"),
            "0600",
        ) {
            cleanup();
            return Err(e);
        }
    }

    let install = install_command(&stage, &endpoint, custom_tls);
    if let Err(e) = ssh_run(&credential, &endpoint, &temp, &install) {
        cleanup();
        return Err(e);
    }

    save_ssh_credential(data_dir, &endpoint.host, &credential)?;

    let ok = verify_public_endpoint(&endpoint.endpoint);
    let mut message = if ok {
        format!("已在服务器创建同步服务：{}", endpoint.endpoint)
    } else {
        format!(
            "服务器已安装，但暂时无法从本机访问：{}/healthz；请检查防火墙、DNS、端口映射和证书",
            endpoint.endpoint
        )
    };
    if removed_existing {
        message = format!("已删除旧服务后重新创建。{message}");
    }

    Ok(ProvisionResult {
        host: endpoint.host,
        port: endpoint.backend_port,
        endpoint: endpoint.endpoint,
        message,
        removed_existing,
    })
}

pub fn host_from_server_url(raw: &str) -> Option<String> {
    parse_endpoint(raw).ok().map(|e| e.host)
}

#[cfg(test)]
mod tests {
    use super::{host_key_lines_match, known_host_query, shell_quote};

    #[test]
    fn known_host_query_uses_openssh_port_format() {
        assert_eq!(known_host_query("example.com", 22), "example.com");
        assert_eq!(known_host_query("example.com", 2222), "[example.com]:2222");
    }

    #[test]
    fn host_key_lines_must_match_the_requested_host() {
        let standard = vec!["example.com ssh-ed25519 AAAA".to_string()];
        assert!(host_key_lines_match("example.com", 22, &standard));

        let alternate_port = vec!["[example.com]:2222 ssh-ed25519 AAAA".to_string()];
        assert!(host_key_lines_match("example.com", 2222, &alternate_port));
        assert!(!host_key_lines_match("example.com", 2222, &standard));

        let wrong_host = vec!["attacker.example ssh-ed25519 AAAA".to_string()];
        assert!(!host_key_lines_match("example.com", 22, &wrong_host));
        assert!(!host_key_lines_match("example.com", 22, &[]));
    }

    #[test]
    fn shell_quote_preserves_paths_without_allowing_quote_escape() {
        assert_eq!(
            shell_quote("/etc/pass-sync/server.key"),
            "'/etc/pass-sync/server.key'"
        );
        assert_eq!(
            shell_quote("/tmp/it's-a-key; rm -rf /"),
            "'/tmp/it'\"'\"'s-a-key; rm -rf /'"
        );
    }
}
