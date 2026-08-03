from __future__ import annotations

import json
import os
import socket
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pass_sync_server as server_module
from pass_sync_server import AppConfig, build_server, load_config, parse_ascii_decimal


def sample_bundle(exported_at_ms: int = 1_777_777_777_777) -> bytes:
    return json.dumps(
        {
            "schema": "pass.sync.encrypted.v1",
            "exportedAtMs": exported_at_ms,
            "cipher": "AES-256-GCM",
            "nonceBase64": "AAAAAAAAAAAAAAAA",
            "ciphertextBase64": "AAAAAAAAAAAAAAAAAAAAAAAA",
        }
    ).encode("utf-8")


class PassSyncServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        config = AppConfig(
            host="127.0.0.1",
            port=0,
            db_path=Path(self.temp_dir.name) / "sync.sqlite3",
            token_scopes={"secret-token": "default"},
            allow_plaintext=True,
            allowed_origins=("chrome-extension://test", "moz-extension://test"),
        )
        self.server = build_server(config)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.temp_dir.cleanup()

    def test_version_id_accepts_ascii_decimal_only(self) -> None:
        self.assertEqual(parse_ascii_decimal("42"), 42)
        self.assertEqual(parse_ascii_decimal("٠١"), None)
        self.assertEqual(parse_ascii_decimal("１２"), None)
        self.assertEqual(parse_ascii_decimal("+1"), None)
        self.assertEqual(parse_ascii_decimal(""), None)

    def test_repository_restricts_database_files_and_uses_full_durability(self) -> None:
        db_path = Path(self.temp_dir.name) / "private.sqlite3"
        repository = server_module.PayloadRepository(db_path)
        self.assertEqual(db_path.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(db_path.stat().st_mode & 0o777, 0o600)
        with repository._managed_connect() as connection:
            self.assertEqual(connection.execute("PRAGMA synchronous;").fetchone()[0], 2)

    def test_rate_limit_discards_expired_client_windows(self) -> None:
        current_window = int(time.time() // 60)
        self.server._rate_windows = {
            "expired": (current_window - 2, 1),
            "recent": (current_window - 1, 1),
        }
        self.server.enforce_rate_limit("current")
        self.assertNotIn("expired", self.server._rate_windows)
        self.assertIn("recent", self.server._rate_windows)
        self.assertIn("current", self.server._rate_windows)

    def test_audit_history_is_bounded_per_scope(self) -> None:
        original_limit = server_module.MAX_AUDIT_OPERATIONS_PER_SCOPE
        server_module.MAX_AUDIT_OPERATIONS_PER_SCOPE = 3
        try:
            for index in range(5):
                self.server.repository.record_operation(
                    "default", "put", "success", f"etag-{index}", None
                )
            operations = self.server.repository.list_operations("default", limit=100)
            self.assertEqual(len(operations), 3)
            self.assertEqual([item.etag for item in operations], ["etag-4", "etag-3", "etag-2"])
        finally:
            server_module.MAX_AUDIT_OPERATIONS_PER_SCOPE = original_limit

    def test_scope_revisions_are_independent_and_idempotent_replay_keeps_revision(self) -> None:
        repository = self.server.repository

        def put(scope: str, exported_at_ms: int, if_match: str | None = None, key: str | None = None):
            payload_json, payload_sha256, exported = server_module.parse_and_validate_bundle(
                sample_bundle(exported_at_ms)
            )
            return repository.put(scope, payload_json, payload_sha256, exported, if_match, idempotency_key=key)

        first_default = put("default", 1, key="scope-default-1")
        first_other = put("other", 2, key="scope-other-1")
        second_default = put("default", 3, if_match=first_default.etag, key="scope-default-2")
        replay = put("default", 3, if_match=second_default.etag, key="scope-default-2")

        self.assertEqual(first_default.scope_revision, 1)
        self.assertEqual(first_other.scope_revision, 1)
        self.assertEqual(second_default.scope_revision, 2)
        self.assertEqual(replay.scope_revision, second_default.scope_revision)
        self.assertEqual(repository.current_revision("default"), 2)
        self.assertEqual(repository.current_revision("other"), 1)

    def test_legacy_revision_columns_are_backfilled_per_scope(self) -> None:
        legacy_dir = tempfile.TemporaryDirectory()
        db_path = Path(legacy_dir.name) / "legacy.sqlite3"
        try:
            connection = sqlite3.connect(db_path)
            connection.executescript(
                """
                CREATE TABLE payloads (
                  scope TEXT PRIMARY KEY NOT NULL,
                  etag TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  payload_sha256 TEXT NOT NULL,
                  exported_at_ms INTEGER NOT NULL,
                  updated_at_ms INTEGER NOT NULL
                );
                CREATE TABLE payload_versions (
                  version_id INTEGER PRIMARY KEY AUTOINCREMENT,
                  scope TEXT NOT NULL,
                  etag TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  payload_sha256 TEXT NOT NULL,
                  exported_at_ms INTEGER NOT NULL,
                  updated_at_ms INTEGER NOT NULL,
                  saved_at_ms INTEGER NOT NULL
                );
                CREATE TABLE sync_idempotency (
                  scope TEXT NOT NULL,
                  idempotency_key TEXT NOT NULL,
                  etag TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  payload_sha256 TEXT NOT NULL,
                  exported_at_ms INTEGER NOT NULL,
                  updated_at_ms INTEGER NOT NULL,
                  created_at_ms INTEGER NOT NULL,
                  PRIMARY KEY(scope, idempotency_key)
                );
                """
            )
            rows = [
                ("default", '"legacy-1"', "{}", "sha-1", 1, 1, 1),
                ("default", '"legacy-2"', "{}", "sha-2", 2, 2, 2),
                ("other", '"legacy-3"', "{}", "sha-3", 3, 3, 3),
            ]
            connection.executemany(
                """
                INSERT INTO payload_versions (
                  scope, etag, payload_json, payload_sha256,
                  exported_at_ms, updated_at_ms, saved_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?);
                """,
                rows,
            )
            connection.execute(
                """
                INSERT INTO sync_idempotency (
                  scope, idempotency_key, etag, payload_json, payload_sha256,
                  exported_at_ms, updated_at_ms, created_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                """,
                ("default", "legacy-key", '"legacy-2"', "{}", "sha-2", 2, 2, 2),
            )
            connection.commit()
            connection.close()

            repository = server_module.PayloadRepository(db_path)
            default_versions = repository.list_versions("default")
            other_versions = repository.list_versions("other")
            self.assertEqual([item.scope_revision for item in default_versions], [2, 1])
            self.assertEqual([item.scope_revision for item in other_versions], [1])
            self.assertEqual(repository.current_revision("default"), 2)
            with sqlite3.connect(db_path) as migrated:
                migrated.row_factory = sqlite3.Row
                row = migrated.execute(
                    "SELECT scope_revision FROM sync_idempotency WHERE scope = ? AND idempotency_key = ?",
                    ("default", "legacy-key"),
                ).fetchone()
            self.assertEqual(int(row["scope_revision"]), 2)
        finally:
            legacy_dir.cleanup()

    def test_slow_connection_cannot_exhaust_bounded_workers(self) -> None:
        limited_dir = tempfile.TemporaryDirectory()
        limited_server = build_server(AppConfig(
            host="127.0.0.1",
            port=0,
            db_path=Path(limited_dir.name) / "limited.sqlite3",
            token_scopes={"secret-token": "default"},
            max_concurrent_requests=1,
            client_timeout_seconds=1.0,
        ))
        limited_thread = threading.Thread(target=limited_server.serve_forever, daemon=True)
        limited_thread.start()
        slow_client = socket.create_connection(limited_server.server_address, timeout=1)
        try:
            slow_client.sendall(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\n")
            time.sleep(0.05)
            with self.assertRaises(urllib.error.HTTPError) as context:
                urllib.request.urlopen(
                    f"http://127.0.0.1:{limited_server.server_address[1]}/healthz",
                    timeout=2,
                )
            self.assertEqual(context.exception.code, 503)
            context.exception.close()
            self.assertGreaterEqual(limited_server.metrics_snapshot()["metrics"]["overloaded"], 1)
        finally:
            slow_client.close()
            limited_server.shutdown()
            limited_server.server_close()
            limited_thread.join(timeout=2)
            limited_dir.cleanup()

    def test_missing_token_file_falls_back_to_environment_token(self) -> None:
        previous = {
            key: os.environ.get(key)
            for key in (
                "PASS_SYNC_BEARER_TOKENS_FILE",
                "PASS_SYNC_BEARER_TOKENS",
                "PASS_SYNC_DB_PATH",
            )
        }
        try:
            os.environ["PASS_SYNC_BEARER_TOKENS_FILE"] = str(Path(self.temp_dir.name) / "not-created.conf")
            os.environ["PASS_SYNC_BEARER_TOKENS"] = "default=environment-token"
            os.environ["PASS_SYNC_DB_PATH"] = str(Path(self.temp_dir.name) / "config.sqlite3")
            config = load_config()
            self.assertEqual(config.token_scopes, {"environment-token": "default"})
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value

    def request(self, method: str, path: str, body: bytes | None = None, headers: dict[str, str] | None = None):
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            method=method,
            headers=headers or {},
        )
        return urllib.request.urlopen(request, timeout=5)

    def test_healthz(self) -> None:
        with self.request("GET", "/healthz") as response:
            self.assertEqual(response.status, 200)
            payload = json.loads(response.read().decode("utf-8"))
        self.assertTrue(payload["ok"])

    def test_metrics_options_path_is_available(self) -> None:
        with self.request("OPTIONS", "/metrics") as response:
            self.assertEqual(response.status, 204)

    def test_cors_rejects_unconfigured_origin(self) -> None:
        with self.request(
            "GET",
            "/healthz",
            headers={"Origin": "https://untrusted.example"},
        ) as response:
            self.assertEqual(response.status, 200)
            self.assertNotIn("Access-Control-Allow-Origin", response.headers)

    def test_metrics_requires_auth_and_reports_requests(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request("GET", "/metrics")
        self.assertEqual(context.exception.code, 401)
        context.exception.close()
        with self.request("GET", "/metrics", headers={"Authorization": "Bearer secret-token"}) as response:
            self.assertEqual(response.status, 200)
            payload = json.loads(response.read().decode("utf-8"))
        self.assertTrue(payload["metrics"]["requests"] >= 1)

    def test_rate_limit_rejects_excessive_requests(self) -> None:
        self.server.config = AppConfig(
            host=self.server.config.host,
            port=self.server.config.port,
            db_path=self.server.config.db_path,
            token_scopes=self.server.config.token_scopes,
            allow_plaintext=self.server.config.allow_plaintext,
            rate_limit_per_minute=10,
        )
        for _ in range(10):
            with self.request("GET", "/healthz") as response:
                self.assertEqual(response.status, 200)
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request("GET", "/healthz")
        self.assertEqual(context.exception.code, 429)
        context.exception.close()

    def test_requires_token_when_configured(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request("GET", "/v1/sync/payload")
        self.assertEqual(context.exception.code, 401)
        context.exception.close()

    def test_allows_payload_requests_without_token_configuration(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)

        config = AppConfig(
            host="127.0.0.1",
            port=0,
            db_path=Path(self.temp_dir.name) / "unauthenticated.sqlite3",
            token_scopes={},
        )
        self.server = build_server(config)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"

        # Empty token configuration is the explicit open-server mode used by
        # the desktop provisioning UI.  An empty database still returns 404,
        # but the request reaches payload handling instead of AUTH_NOT_CONFIGURED.
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request("GET", "/v1/sync/payload")
        self.assertEqual(context.exception.code, 404)
        context.exception.close()

    def test_put_then_get_roundtrip(self) -> None:
        with self.request(
            "PUT",
            "/v1/sync/payload",
            body=sample_bundle(),
            headers={
                "Authorization": "Bearer secret-token",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        ) as response:
            self.assertEqual(response.status, 200)
            etag = response.headers["ETag"]
            self.assertTrue(etag)

        with self.request(
            "GET",
            "/v1/sync/payload",
            headers={"Authorization": "Bearer secret-token"},
        ) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["ETag"], etag)
            parsed = json.loads(response.read().decode("utf-8"))
        self.assertEqual(parsed["schema"], "pass.sync.encrypted.v1")

    def test_v2_state_alias_exposes_revision_and_etag(self) -> None:
        headers = {
            "Authorization": "Bearer secret-token",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Idempotency-Key": "v2-state-1",
        }
        with self.request("PUT", "/v2/sync/state", body=sample_bundle(10), headers=headers) as response:
            self.assertEqual(response.status, 200)
            self.assertGreaterEqual(int(response.headers["X-Sync-Revision"]), 1)
            put_body = json.loads(response.read().decode("utf-8"))
        self.assertEqual(put_body["revision"], int(response.headers["X-Sync-Revision"]))
        self.assertTrue(put_body["ok"])
        self.assertTrue(put_body["committed"])
        self.assertEqual(put_body["scope"], "default")
        self.assertEqual(put_body["idempotencyKey"], "v2-state-1")
        self.assertEqual(put_body["etag"], response.headers["ETag"])
        self.assertEqual(put_body["payloadSha256"], response.headers["X-Payload-Sha256"])

        with self.request(
            "GET",
            "/v2/sync/state",
            headers={"Authorization": "Bearer secret-token"},
        ) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["ETag"], put_body["etag"])
            self.assertEqual(int(response.headers["X-Sync-Revision"]), put_body["revision"])
            self.assertEqual(json.loads(response.read().decode("utf-8"))["exportedAtMs"], 10)

    def test_v2_version_and_audit_aliases(self) -> None:
        headers = {
            "Authorization": "Bearer secret-token",
            "Content-Type": "application/json",
            "Idempotency-Key": "v2-version-alias-1",
        }
        with self.request("PUT", "/v2/sync/state", body=sample_bundle(20), headers=headers):
            pass
        with self.request(
            "GET",
            "/v2/sync/versions",
            headers={"Authorization": "Bearer secret-token"},
        ) as response:
            self.assertEqual(response.status, 200)
            versions = json.loads(response.read().decode("utf-8"))["versions"]
        self.assertTrue(versions)
        version_id = versions[0]["versionId"]
        with self.request(
            "GET",
            f"/v2/sync/versions/{version_id}",
            headers={"Authorization": "Bearer secret-token"},
        ) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.read().decode("utf-8"))["exportedAtMs"], 20)
        with self.request(
            "GET",
            "/v2/sync/audit",
            headers={"Authorization": "Bearer secret-token"},
        ) as response:
            self.assertEqual(response.status, 200)
            self.assertTrue(json.loads(response.read().decode("utf-8"))["operations"])

    def test_idempotency_key_replays_original_write(self) -> None:
        headers = {
            "Authorization": "Bearer secret-token",
            "Content-Type": "application/json",
            "Idempotency-Key": "sync-retry-1",
        }
        with self.request("PUT", "/v1/sync/payload", body=sample_bundle(100), headers=headers) as response:
            first_etag = response.headers["ETag"]
            first_body = json.loads(response.read().decode("utf-8"))

        with self.request(
            "PUT",
            "/v1/sync/payload",
            body=sample_bundle(100),
            headers=headers,
        ) as response:
            self.assertEqual(response.headers["ETag"], first_etag)
            self.assertEqual(json.loads(response.read().decode("utf-8")), first_body)

    def test_existing_state_requires_if_match(self) -> None:
        headers = {
            "Authorization": "Bearer secret-token",
            "Content-Type": "application/json",
        }
        with self.request("PUT", "/v2/sync/state", body=sample_bundle(10), headers=headers) as response:
            self.assertEqual(response.status, 200)

        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request(
                "PUT",
                "/v2/sync/state",
                body=sample_bundle(11),
                headers=headers,
            )
        self.assertEqual(context.exception.code, 428)
        context.exception.close()

    def test_idempotency_replay_rejects_stale_snapshot(self) -> None:
        auth = {"Authorization": "Bearer secret-token", "Content-Type": "application/json"}
        first_headers = {**auth, "Idempotency-Key": "stale-key"}
        with self.request("PUT", "/v2/sync/state", body=sample_bundle(20), headers=first_headers) as response:
            first_etag = response.headers["ETag"]

        with self.request(
            "PUT",
            "/v2/sync/state",
            body=sample_bundle(21),
            headers={**auth, "If-Match": first_etag, "Idempotency-Key": "other-key"},
        ) as response:
            self.assertEqual(response.status, 200)

        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request(
                "PUT",
                "/v2/sync/state",
                body=sample_bundle(20),
                headers=first_headers,
            )
        self.assertEqual(context.exception.code, 409)
        context.exception.close()

    def test_rejects_plaintext_bundle(self) -> None:
        plaintext = json.dumps({
            "schema": "pass.sync.bundle.legacy",
            "exportedAtMs": 1,
            "source": {},
            "payload": {"accounts": [], "folders": [], "passkeys": []},
        }).encode("utf-8")
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request(
                "PUT",
                "/v1/sync/payload",
                body=plaintext,
                headers={
                    "Authorization": "Bearer secret-token",
                    "Content-Type": "application/json",
                },
            )
        self.assertEqual(context.exception.code, 400)
        context.exception.close()

    def test_encrypted_bundle_accepts_valid_key_id_and_rejects_malformed_one(self) -> None:
        headers = {
            "Authorization": "Bearer secret-token",
            "Content-Type": "application/json",
        }
        valid = json.loads(sample_bundle(30).decode("utf-8"))
        valid["keyId"] = "k1-0123456789abcdef"
        with self.request("PUT", "/v2/sync/state", body=json.dumps(valid).encode("utf-8"), headers=headers) as response:
            self.assertEqual(response.status, 200)

        invalid = json.loads(sample_bundle(31).decode("utf-8"))
        invalid["keyId"] = "not-a-key-id"
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request("PUT", "/v2/sync/state", body=json.dumps(invalid).encode("utf-8"), headers=headers)
        self.assertEqual(context.exception.code, 400)
        context.exception.close()

    def test_accepts_plaintext_bundle_v2(self) -> None:
        plaintext = json.dumps({
            "schema": "pass.sync.bundle.v2",
            "exportedAtMs": 1_777_777_777_777,
            "source": {"app": "pass-extension", "version": "0.1.9"},
            "payload": {"accounts": [], "folders": [], "passkeys": []},
        }).encode("utf-8")
        with self.request(
            "PUT",
            "/v1/sync/payload",
            body=plaintext,
            headers={
                "Authorization": "Bearer secret-token",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        ) as response:
            self.assertEqual(response.status, 200)
            etag = response.headers["ETag"]
            self.assertTrue(etag)

        with self.request(
            "GET",
            "/v1/sync/payload",
            headers={"Authorization": "Bearer secret-token"},
        ) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["ETag"], etag)
            parsed = json.loads(response.read().decode("utf-8"))
        self.assertEqual(parsed["schema"], "pass.sync.bundle.v2")
        self.assertEqual(parsed["payload"]["accounts"], [])

    def test_production_mode_rejects_plaintext_bundle_v2(self) -> None:
        self.server.config = AppConfig(
            host="127.0.0.1",
            port=0,
            db_path=Path(self.temp_dir.name) / "sync.sqlite3",
            token_scopes={"secret-token": "default"},
            allow_plaintext=False,
        )
        plaintext = json.dumps({
            "schema": "pass.sync.bundle.v2",
            "exportedAtMs": 1_777_777_777_777,
            "source": {"app": "pass-extension"},
            "payload": {"accounts": [], "folders": [], "passkeys": []},
        }).encode("utf-8")
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request(
                "PUT",
                "/v1/sync/payload",
                body=plaintext,
                headers={"Authorization": "Bearer secret-token", "Content-Type": "application/json"},
            )
        self.assertEqual(context.exception.code, 400)
        context.exception.close()

    def test_startup_removes_legacy_plaintext_payload(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        db_path = Path(self.temp_dir.name) / "legacy.sqlite3"
        with sqlite3.connect(db_path) as connection:
            connection.execute(
                "CREATE TABLE payloads (scope TEXT PRIMARY KEY, etag TEXT, payload_json TEXT, "
                "payload_sha256 TEXT, exported_at_ms INTEGER, updated_at_ms INTEGER)"
            )
            connection.execute(
                "INSERT INTO payloads VALUES (?, ?, ?, ?, ?, ?)",
                ("default", '"old"', json.dumps({"schema": "pass.sync.unknown", "payload": {}}), "old", 1, 1),
            )
        previous = os.environ.get("PASS_SYNC_PURGE_LEGACY")
        os.environ["PASS_SYNC_PURGE_LEGACY"] = "1"
        try:
            config = AppConfig(host="127.0.0.1", port=0, db_path=db_path, token_scopes={"secret-token": "default"})
            self.server = build_server(config)
        finally:
            if previous is None:
                os.environ.pop("PASS_SYNC_PURGE_LEGACY", None)
            else:
                os.environ["PASS_SYNC_PURGE_LEGACY"] = previous
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request("GET", "/v1/sync/payload", headers={"Authorization": "Bearer secret-token"})
        self.assertEqual(context.exception.code, 404)
        context.exception.close()
        purged = list(Path(self.temp_dir.name).glob("purged_payloads_*.jsonl"))
        self.assertTrue(purged)

    def test_options_preflight_for_payload(self) -> None:
        with self.request(
            "OPTIONS",
            "/v1/sync/payload",
            headers={
                "Origin": "moz-extension://test",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        ) as response:
            self.assertEqual(response.status, 204)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "moz-extension://test")
            self.assertIn("GET", response.headers["Access-Control-Allow-Methods"])
            self.assertIn("authorization", response.headers["Access-Control-Allow-Headers"])

    def test_get_payload_includes_cors_origin_header(self) -> None:
        headers = {
            "Authorization": "Bearer secret-token",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        with self.request("PUT", "/v1/sync/payload", body=sample_bundle(), headers=headers) as response:
            self.assertEqual(response.status, 200)

        with self.request(
            "GET",
            "/v1/sync/payload",
            headers={
                "Authorization": "Bearer secret-token",
                "Origin": "chrome-extension://test",
            },
        ) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "chrome-extension://test")

    def test_if_match_conflict(self) -> None:
        headers = {
            "Authorization": "Bearer secret-token",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        with self.request("PUT", "/v1/sync/payload", body=sample_bundle(1000), headers=headers) as response:
            first_etag = response.headers["ETag"]

        with self.request(
            "PUT",
            "/v1/sync/payload",
            body=sample_bundle(2000),
            headers={**headers, "If-Match": first_etag},
        ) as response:
            self.assertEqual(response.status, 200)

        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request(
                "PUT",
                "/v1/sync/payload",
                body=sample_bundle(3000),
                headers={**headers, "If-Match": first_etag},
            )
        self.assertEqual(context.exception.code, 412)
        context.exception.close()

    def test_successful_writes_keep_version_history(self) -> None:
        headers = {
            "Authorization": "Bearer secret-token",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        with self.request("PUT", "/v1/sync/payload", body=sample_bundle(4000), headers=headers) as response:
            self.assertEqual(response.status, 200)
            first_etag = response.headers["ETag"]
        with self.request(
            "PUT",
            "/v1/sync/payload",
            body=sample_bundle(5000),
            headers={**headers, "If-Match": first_etag},
        ) as response:
            self.assertEqual(response.status, 200)

        with self.request("GET", "/v1/sync/versions", headers=headers) as response:
            versions = json.loads(response.read().decode("utf-8"))["versions"]
        self.assertEqual(len(versions), 2)
        self.assertEqual([item["versionId"] for item in reversed(versions)], [1, 2])
        self.assertNotEqual(versions[0]["payloadSha256"], versions[-1]["payloadSha256"])

        oldest_version_id = versions[-1]["versionId"]
        with self.request(
            "GET",
            f"/v1/sync/versions/{oldest_version_id}",
            headers=headers,
        ) as response:
            restored = json.loads(response.read().decode("utf-8"))
        self.assertEqual(restored["exportedAtMs"], 4000)

    def test_restore_version_requires_current_etag_and_creates_new_snapshot(self) -> None:
        headers = {
            "Authorization": "Bearer secret-token",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        with self.request("PUT", "/v1/sync/payload", body=sample_bundle(6000), headers=headers) as response:
            first_etag = response.headers["ETag"]
        with self.request(
            "PUT",
            "/v1/sync/payload",
            body=sample_bundle(7000),
            headers={**headers, "If-Match": first_etag},
        ) as response:
            current_etag = response.headers["ETag"]

        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request("POST", "/v1/sync/versions/1/restore", headers=headers)
        self.assertEqual(context.exception.code, 428)
        context.exception.close()

        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request(
                "POST",
                "/v1/sync/versions/1/restore",
                headers={**headers, "If-Match": first_etag, "Idempotency-Key": "restore-test-1"},
            )
        self.assertEqual(context.exception.code, 412)
        context.exception.close()

        with self.request(
            "POST",
            "/v1/sync/versions/1/restore",
            headers={**headers, "If-Match": current_etag, "Idempotency-Key": "restore-test-2"},
        ) as response:
            self.assertEqual(response.status, 200)
            restored_etag = response.headers["ETag"]
            result = json.loads(response.read().decode("utf-8"))
        self.assertTrue(result["ok"])
        self.assertNotEqual(restored_etag, current_etag)

        with self.request(
            "POST",
            "/v1/sync/versions/1/restore",
            headers={**headers, "If-Match": restored_etag, "Idempotency-Key": "restore-test-2"},
        ) as response:
            replayed = json.loads(response.read().decode("utf-8"))
        self.assertEqual(replayed["etag"], restored_etag)
        self.assertEqual(replayed["revision"], result["revision"])

        with self.request("GET", "/v1/sync/payload", headers=headers) as response:
            restored = json.loads(response.read().decode("utf-8"))
        self.assertEqual(restored["exportedAtMs"], 6000)

    def test_options_allows_version_download_path(self) -> None:
        request = urllib.request.Request(
            f"{self.base_url}/v1/sync/versions/1",
            method="OPTIONS",
            headers={
                "Origin": "chrome-extension://test",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            self.assertEqual(response.status, 204)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "chrome-extension://test")

    def test_options_allows_version_restore_path(self) -> None:
        request = urllib.request.Request(
            f"{self.base_url}/v1/sync/versions/1/restore",
            method="OPTIONS",
            headers={
                "Origin": "chrome-extension://test",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization, if-match",
            },
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            self.assertEqual(response.status, 204)
            self.assertIn("POST", response.headers["Access-Control-Allow-Methods"])
            self.assertIn("if-match", response.headers["Access-Control-Allow-Headers"])

    def test_audit_lists_success_and_conflict_operations(self) -> None:
        headers = {
            "Authorization": "Bearer secret-token",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        with self.request("PUT", "/v1/sync/payload", body=sample_bundle(8000), headers=headers) as response:
            first_etag = response.headers["ETag"]
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request(
                "PUT",
                "/v1/sync/payload",
                body=sample_bundle(9000),
                headers={**headers, "If-Match": '"stale"'},
            )
        self.assertEqual(context.exception.code, 412)
        context.exception.close()
        with self.request("GET", "/v1/sync/audit", headers=headers) as response:
            operations = json.loads(response.read().decode("utf-8"))["operations"]
        self.assertGreaterEqual(len(operations), 2)
        self.assertEqual(operations[0]["status"], "conflict")
        self.assertEqual(operations[1]["operation"], "put")
        self.assertEqual(operations[1]["etag"], first_etag)

    def test_audit_keeps_client_trace_headers(self) -> None:
        headers = {
            "Authorization": "Bearer secret-token",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Idempotency-Key": "trace-key-1",
            "X-Sync-Session-Id": "session-1",
            "X-Sync-Operation-Id": "operation-1",
            "X-Sync-Client-Device-Id": "device-1",
            "X-Sync-Client-Version": "1.3.5",
        }
        with self.request("PUT", "/v2/sync/state", body=sample_bundle(8100), headers=headers):
            pass
        with self.request("GET", "/v2/sync/audit", headers=headers) as response:
            operation = json.loads(response.read().decode("utf-8"))["operations"][0]
        self.assertEqual(operation["syncSessionId"], "session-1")
        self.assertEqual(operation["traceOperationId"], "operation-1")
        self.assertEqual(operation["clientDeviceId"], "device-1")
        self.assertEqual(operation["clientVersion"], "1.3.5")

    def test_options_allows_audit_path(self) -> None:
        request = urllib.request.Request(
            f"{self.base_url}/v1/sync/audit",
            method="OPTIONS",
            headers={
                "Origin": "chrome-extension://test",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            self.assertEqual(response.status, 204)
            self.assertEqual(response.headers["Access-Control-Allow-Origin"], "chrome-extension://test")

    def test_rejects_payload_larger_than_configured_limit(self) -> None:
        self.server.config = AppConfig(
            host="127.0.0.1",
            port=0,
            db_path=Path(self.temp_dir.name) / "sync.sqlite3",
            token_scopes={"secret-token": "default"},
            max_body_bytes=32,
        )
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request(
                "PUT",
                "/v1/sync/payload",
                body=sample_bundle(),
                headers={
                    "Authorization": "Bearer secret-token",
                    "Content-Type": "application/json",
                },
            )
        self.assertEqual(context.exception.code, 413)
        context.exception.close()


if __name__ == "__main__":
    unittest.main()
