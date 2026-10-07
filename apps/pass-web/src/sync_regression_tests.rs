use super::*;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpListener as TestListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::{self, JoinHandle};

enum Fault {
    Conflict(Vec<u8>),
    Unavailable,
    LostReceipt,
}

struct RemoteState {
    body: Vec<u8>,
    revision: u64,
    puts: usize,
    faults: VecDeque<Fault>,
}

struct TestRemote {
    url: String,
    state: Arc<Mutex<RemoteState>>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl TestRemote {
    // 只替换 HTTP 边界，真实编排、加密、落盘、回执和补偿逻辑全部参与测试。
    fn start(body: Vec<u8>, faults: Vec<Fault>) -> Self {
        let listener = TestListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let state = Arc::new(Mutex::new(RemoteState {
            body,
            revision: 1,
            puts: 0,
            faults: faults.into(),
        }));
        let stop = Arc::new(AtomicBool::new(false));
        let worker_state = state.clone();
        let worker_stop = stop.clone();
        let worker = thread::spawn(move || {
            while !worker_stop.load(Ordering::Relaxed) {
                let (mut stream, _) = match listener.accept() {
                    Ok(stream) => stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(error) => panic!("测试服务接受连接失败：{error}"),
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut first = String::new();
                reader.read_line(&mut first).unwrap();
                let mut headers = BTreeMap::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                    if let Some((key, value)) = line.split_once(':') {
                        headers.insert(key.to_ascii_lowercase(), value.trim().to_string());
                    }
                }
                let length = headers
                    .get("content-length")
                    .and_then(|value| value.parse::<usize>().ok())
                    .unwrap_or(0);
                let mut input = vec![0; length];
                reader.read_exact(&mut input).unwrap();
                let mut state = worker_state.lock().unwrap();
                let mut status = 200;
                let mut lost_receipt = false;
                if first.starts_with("PUT ") {
                    state.puts += 1;
                    match state.faults.pop_front() {
                        Some(Fault::Conflict(body)) => {
                            state.body = body;
                            state.revision += 1;
                            status = 412;
                        }
                        Some(Fault::Unavailable) => status = 503,
                        fault => {
                            let current = format!("\"revision-{}\"", state.revision);
                            assert_eq!(headers.get("if-match"), Some(&current));
                            state.body = input.clone();
                            state.revision += 1;
                            lost_receipt = matches!(fault, Some(Fault::LostReceipt));
                        }
                    }
                }
                if lost_receipt {
                    continue;
                }
                let etag = format!("\"revision-{}\"", state.revision);
                let idempotency = headers.get("idempotency-key").cloned().unwrap_or_default();
                let hash = Sha256::digest(&input)
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>();
                let body = if first.starts_with("GET ") {
                    state.body.clone()
                } else {
                    serde_json::to_vec(&json!({ "ok": status == 200, "committed": status == 200,
                        "scope": "synthetic", "etag": etag, "revision": state.revision,
                        "idempotencyKey": idempotency, "payloadSha256": hash }))
                    .unwrap()
                };
                let response = format!("HTTP/1.1 {status} Test\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\nETag: {etag}\r\nX-Sync-Scope: synthetic\r\nX-Sync-Revision: {}\r\nX-Sync-Idempotency-Key: {idempotency}\r\nX-Payload-Sha256: {hash}\r\n\r\n", body.len(), state.revision);
                drop(state);
                stream.write_all(response.as_bytes()).unwrap();
                stream.write_all(&body).unwrap();
            }
        });
        Self {
            url,
            state,
            stop,
            worker: Some(worker),
        }
    }
}

impl Drop for TestRemote {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let result = self.worker.take().unwrap().join();
        if !thread::panicking() {
            result.unwrap();
        }
    }
}

fn test_vault() -> Vault {
    let dir = std::env::temp_dir().join(format!("pass-web-sync-regression-{}", Uuid::new_v4()));
    let mut vault = Vault::open(dir).unwrap();
    vault.data.device_name = "test-device".into();
    vault.data.accounts.push(PasswordAccount {
        record_id: Some("00000000-0000-4000-8000-000000000001".into()),
        account_id: "synthetic-active".into(),
        sites: vec!["active.test".into()],
        password: "local-value".into(),
        created_at_ms: 100,
        updated_at_ms: 100,
        password_updated_at_ms: 100,
        last_operated_device_name: "test-device".into(),
        ..Default::default()
    });
    vault
}

fn configure(vault: &mut Vault, remote: &TestRemote, key: &str, previous_key: &str) {
    vault.data.sync_settings =
        json!({ "enabled": true, "baseUrl": remote.url, "encryptionKey": key });
    vault.data.ui_prefs = json!({ "webdavEnabled": true, "webdavBaseUrl": remote.url,
        "webdavRemotePath": "sync.json", "previousEncryptionKey": previous_key });
}

fn wire(payload: &SyncPayload, key: &str) -> Vec<u8> {
    encrypt_sync_document(
        &json!({ "schema": "pass.sync.bundle.v2", "payload": payload }),
        key,
    )
    .unwrap()
}

fn run(vault: &mut Vault, webdav: bool, mode: SyncMode, resume: bool) -> Value {
    if webdav {
        run_webdav_sync(vault, mode, false, true, resume)
    } else {
        run_self_hosted_sync(vault, mode, false, true, resume)
    }
    .unwrap()
}

#[test]
fn both_transports_keep_newly_received_tombstones_after_remote_rollback() {
    for webdav in [false, true] {
        for mode in [SyncMode::Merge, SyncMode::RemoteOverwriteLocal] {
            let mut vault = test_vault();
            let restored = vault.payload();
            let mut first = restored.clone();
            let deleted_id = "00000000-0000-4000-8000-000000000002";
            first.accounts.push(PasswordAccount {
                record_id: Some(deleted_id.into()),
                account_id: "synthetic-tombstone".into(),
                is_deleted: true,
                is_permanently_deleted: true,
                deleted_at_ms: Some(200),
                ..Default::default()
            });
            let remote = TestRemote::start(
                wire(&first, ""),
                vec![
                    Fault::Conflict(wire(&restored, "")),
                    Fault::Conflict(wire(&restored, "")),
                ],
            );
            configure(&mut vault, &remote, "", "");
            let report = run(&mut vault, webdav, mode, false);
            assert!(vault
                .data
                .accounts
                .iter()
                .any(|a| a.resolved_record_id() == deleted_id && a.is_permanently_deleted));
            if mode == SyncMode::Merge {
                assert_eq!(report["report"]["ok"], true, "{report}");
                assert_eq!(remote.state.lock().unwrap().puts, 3);
            } else {
                assert_eq!(report["report"]["code"], "SAFETY_BLOCKED");
                assert_eq!(remote.state.lock().unwrap().puts, 1);
            }
            fs::remove_dir_all(&vault.dir).unwrap();
        }
    }
}

#[test]
fn both_transports_restore_overwrite_intent_after_persisted_failure() {
    for webdav in [false, true] {
        for resume in [true, false] {
            let mut vault = test_vault();
            let mut cloud = vault.payload();
            cloud.accounts[0].password = "cloud-newer".into();
            cloud.accounts[0].password_updated_at_ms = 200;
            cloud.accounts[0].updated_at_ms = 200;
            let remote = TestRemote::start(wire(&cloud, ""), vec![Fault::Unavailable]);
            configure(&mut vault, &remote, "", "");
            let failed = run(&mut vault, webdav, SyncMode::LocalOverwriteRemote, false);
            assert_eq!(failed["report"]["pendingRetry"], true, "{failed}");
            vault.save().unwrap();
            let mut restarted = Vault::open(vault.dir.clone()).unwrap();
            assert_eq!(restarted.data.sync_outbox[0].mode, "localOverwriteRemote");
            let result = run(&mut restarted, webdav, SyncMode::Merge, resume);
            assert_eq!(result["report"]["ok"], true, "{result}");
            assert_eq!(
                restarted.data.accounts[0].password,
                if resume { "local-value" } else { "cloud-newer" }
            );
            assert!(restarted.data.sync_outbox.is_empty());
            fs::remove_dir_all(&vault.dir).unwrap();
        }
    }
}

#[test]
fn both_transports_verify_key_rotation_even_when_payload_matches_or_receipt_is_lost() {
    for webdav in [false, true] {
        let mut vault = test_vault();
        let old = URL_SAFE_NO_PAD.encode([1u8; 32]);
        let new = URL_SAFE_NO_PAD.encode([2u8; 32]);
        let remote = TestRemote::start(
            wire(&vault.payload(), &old),
            vec![Fault::Unavailable, Fault::LostReceipt],
        );
        configure(&mut vault, &remote, &new, &old);
        let failed = run(&mut vault, webdav, SyncMode::LocalOverwriteRemote, false);
        assert_eq!(failed["report"]["pendingRetry"], true, "{failed}");
        assert_eq!(failed["report"]["ok"], false);
        let success = run(&mut vault, webdav, SyncMode::Merge, true);
        assert_eq!(success["report"]["ok"], true, "{success}");
        let state = remote.state.lock().unwrap();
        assert_eq!(state.puts, 2);
        assert!(decrypt_sync_document(&state.body, &new).is_ok());
        assert!(decrypt_sync_document(&state.body, &old).is_err());
        fs::remove_dir_all(&vault.dir).unwrap();
    }
}
