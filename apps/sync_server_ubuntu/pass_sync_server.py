#!/usr/bin/env python3
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import os
import signal
import sqlite3
import ssl
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


LOGGER = logging.getLogger("pass_sync_server")


@dataclass(frozen=True)
class AppConfig:
    host: str
    port: int
    db_path: Path
    token_scopes: dict[str, str]
    max_body_bytes: int = 2 * 1024 * 1024
    allow_plaintext: bool = False
    tls_cert_path: Path | None = None
    tls_key_path: Path | None = None
    rate_limit_per_minute: int = 120
    allowed_origins: tuple[str, ...] = ()

    @property
    def auth_enabled(self) -> bool:
        return bool(self.token_scopes)


@dataclass(frozen=True)
class StoredPayload:
    scope: str
    etag: str
    payload_json: str
    payload_sha256: str
    exported_at_ms: int
    updated_at_ms: int


@dataclass(frozen=True)
class StoredVersion:
    version_id: int
    scope: str
    etag: str
    payload_json: str
    payload_sha256: str
    exported_at_ms: int
    updated_at_ms: int
    saved_at_ms: int


@dataclass(frozen=True)
class StoredOperation:
    operation_id: int
    scope: str
    operation: str
    status: str
    etag: str | None
    version_id: int | None
    created_at_ms: int


class PayloadRepository:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._write_lock = threading.Lock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL;")
        connection.execute("PRAGMA synchronous=NORMAL;")
        return connection

    @contextmanager
    def _managed_connect(self):
        connection = self._connect()
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._managed_connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS payloads (
                  scope TEXT PRIMARY KEY NOT NULL,
                  etag TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  payload_sha256 TEXT NOT NULL,
                  exported_at_ms INTEGER NOT NULL,
                  updated_at_ms INTEGER NOT NULL
                );
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS sync_operations (
                  operation_id INTEGER PRIMARY KEY AUTOINCREMENT,
                  scope TEXT NOT NULL,
                  operation TEXT NOT NULL,
                  status TEXT NOT NULL,
                  etag TEXT,
                  version_id INTEGER,
                  created_at_ms INTEGER NOT NULL
                );
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS payload_versions (
                  version_id INTEGER PRIMARY KEY AUTOINCREMENT,
                  scope TEXT NOT NULL,
                  etag TEXT NOT NULL,
                  payload_json TEXT NOT NULL,
                  payload_sha256 TEXT NOT NULL,
                  exported_at_ms INTEGER NOT NULL,
                  updated_at_ms INTEGER NOT NULL,
                  saved_at_ms INTEGER NOT NULL
                );
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS sync_idempotency (
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
            rows = connection.execute("SELECT scope, payload_json FROM payloads;").fetchall()
            plaintext_scopes = []
            for row in rows:
                try:
                    schema = json.loads(row["payload_json"]).get("schema")
                except (json.JSONDecodeError, AttributeError):
                    schema = None
                if schema not in {"pass.sync.encrypted.v1", "pass.sync.bundle.v2"}:
                    plaintext_scopes.append(row["scope"])
            if plaintext_scopes:
                connection.executemany("DELETE FROM payloads WHERE scope = ?;", [(scope,) for scope in plaintext_scopes])
                LOGGER.warning("Removed %s legacy unsupported payload(s)", len(plaintext_scopes))

    def get(self, scope: str) -> StoredPayload | None:
        with self._managed_connect() as connection:
            row = connection.execute(
                """
                SELECT scope, etag, payload_json, payload_sha256, exported_at_ms, updated_at_ms
                FROM payloads
                WHERE scope = ?
                LIMIT 1;
                """,
                (scope,),
            ).fetchone()
        if row is None:
            return None
        return StoredPayload(
            scope=row["scope"],
            etag=row["etag"],
            payload_json=row["payload_json"],
            payload_sha256=row["payload_sha256"],
            exported_at_ms=row["exported_at_ms"],
            updated_at_ms=row["updated_at_ms"],
        )

    def current_revision(self, scope: str) -> int:
        with self._managed_connect() as connection:
            row = connection.execute(
                "SELECT COALESCE(MAX(version_id), 0) AS revision FROM payload_versions WHERE scope = ? LIMIT 1;",
                (scope,),
            ).fetchone()
        return int(row["revision"] if row is not None else 0)

    def list_versions(self, scope: str, limit: int = 50) -> list[StoredVersion]:
        safe_limit = min(max(int(limit), 1), 50)
        with self._managed_connect() as connection:
            rows = connection.execute(
                """
                SELECT version_id, scope, etag, payload_json, payload_sha256,
                       exported_at_ms, updated_at_ms, saved_at_ms
                FROM payload_versions
                WHERE scope = ?
                ORDER BY version_id DESC
                LIMIT ?;
                """,
                (scope, safe_limit),
            ).fetchall()
        return [
            StoredVersion(
                version_id=row["version_id"],
                scope=row["scope"],
                etag=row["etag"],
                payload_json=row["payload_json"],
                payload_sha256=row["payload_sha256"],
                exported_at_ms=row["exported_at_ms"],
                updated_at_ms=row["updated_at_ms"],
                saved_at_ms=row["saved_at_ms"],
            )
            for row in rows
        ]

    def get_version(self, scope: str, version_id: int) -> StoredVersion | None:
        with self._managed_connect() as connection:
            row = connection.execute(
                """
                SELECT version_id, scope, etag, payload_json, payload_sha256,
                       exported_at_ms, updated_at_ms, saved_at_ms
                FROM payload_versions
                WHERE scope = ? AND version_id = ?
                LIMIT 1;
                """,
                (scope, version_id),
            ).fetchone()
        if row is None:
            return None
        return StoredVersion(
            version_id=row["version_id"],
            scope=row["scope"],
            etag=row["etag"],
            payload_json=row["payload_json"],
            payload_sha256=row["payload_sha256"],
            exported_at_ms=row["exported_at_ms"],
            updated_at_ms=row["updated_at_ms"],
            saved_at_ms=row["saved_at_ms"],
        )

    def put(
        self,
        scope: str,
        payload_json: str,
        payload_sha256: str,
        exported_at_ms: int,
        if_match: str | None,
        operation: str = "put",
        idempotency_key: str | None = None,
    ) -> StoredPayload:
        next_etag = f"\"{payload_sha256}\""
        now_ms = current_time_ms()

        with self._write_lock:
            if idempotency_key:
                with self._managed_connect() as connection:
                    replay = connection.execute(
                        """
                        SELECT etag, payload_json, payload_sha256, exported_at_ms, updated_at_ms
                        FROM sync_idempotency
                        WHERE scope = ? AND idempotency_key = ?
                        LIMIT 1;
                        """,
                        (scope, idempotency_key),
                    ).fetchone()
                if replay is not None:
                    if replay["payload_sha256"] != payload_sha256:
                        raise RequestError(
                            HTTPStatus.CONFLICT,
                            "IDEMPOTENCY_KEY_REUSED",
                            "Idempotency-Key 已经用于另一份同步数据。",
                        )
                    self.record_operation(scope, "idempotent_replay", "success", replay["etag"], None)
                    return StoredPayload(
                        scope=scope,
                        etag=replay["etag"],
                        payload_json=replay["payload_json"],
                        payload_sha256=replay["payload_sha256"],
                        exported_at_ms=replay["exported_at_ms"],
                        updated_at_ms=replay["updated_at_ms"],
                    )
            current = self.get(scope)
            if not etag_matches(current.etag if current else None, if_match):
                self.record_operation(scope, operation, "conflict", current.etag if current else None, None)
                raise PreconditionFailedError()

            with self._managed_connect() as connection:
                if current is not None:
                    connection.execute(
                        """
                        INSERT INTO payload_versions (
                          scope, etag, payload_json, payload_sha256,
                          exported_at_ms, updated_at_ms, saved_at_ms
                        ) VALUES (?, ?, ?, ?, ?, ?, ?);
                        """,
                        (
                            current.scope,
                            current.etag,
                            current.payload_json,
                            current.payload_sha256,
                            current.exported_at_ms,
                            current.updated_at_ms,
                            now_ms,
                        ),
                    )
                connection.execute(
                    """
                    INSERT INTO payloads (
                      scope,
                      etag,
                      payload_json,
                      payload_sha256,
                      exported_at_ms,
                      updated_at_ms
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(scope) DO UPDATE SET
                      etag = excluded.etag,
                      payload_json = excluded.payload_json,
                      payload_sha256 = excluded.payload_sha256,
                      exported_at_ms = excluded.exported_at_ms,
                      updated_at_ms = excluded.updated_at_ms;
                    """,
                    (scope, next_etag, payload_json, payload_sha256, exported_at_ms, now_ms),
                )
                connection.execute(
                    """
                    INSERT INTO payload_versions (
                      scope, etag, payload_json, payload_sha256,
                      exported_at_ms, updated_at_ms, saved_at_ms
                    ) VALUES (?, ?, ?, ?, ?, ?, ?);
                    """,
                    (scope, next_etag, payload_json, payload_sha256, exported_at_ms, now_ms, now_ms),
                )
                if idempotency_key:
                    connection.execute(
                        """
                        INSERT OR IGNORE INTO sync_idempotency (
                          scope, idempotency_key, etag, payload_json, payload_sha256,
                          exported_at_ms, updated_at_ms, created_at_ms
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                        """,
                        (
                            scope,
                            idempotency_key,
                            next_etag,
                            payload_json,
                            payload_sha256,
                            exported_at_ms,
                            now_ms,
                            now_ms,
                        ),
                    )
                    connection.execute(
                        """
                        DELETE FROM sync_idempotency
                        WHERE scope = ?
                          AND rowid NOT IN (
                            SELECT rowid FROM sync_idempotency
                            WHERE scope = ?
                            ORDER BY created_at_ms DESC
                            LIMIT 500
                          );
                        """,
                        (scope, scope),
                    )
                connection.execute(
                    """
                    DELETE FROM payload_versions
                    WHERE scope = ?
                      AND version_id NOT IN (
                        SELECT version_id FROM payload_versions
                        WHERE scope = ?
                        ORDER BY version_id DESC
                        LIMIT 50
                      );
                    """,
                    (scope, scope),
                )

            self.record_operation(scope, operation, "success", next_etag, None)
            return StoredPayload(
                scope=scope,
                etag=next_etag,
                payload_json=payload_json,
                payload_sha256=payload_sha256,
                exported_at_ms=exported_at_ms,
                updated_at_ms=now_ms,
            )

    def restore_version(self, scope: str, version_id: int, if_match: str | None) -> StoredPayload | None:
        version = self.get_version(scope, version_id)
        if version is None:
            return None
        return self.put(
            scope=scope,
            payload_json=version.payload_json,
            payload_sha256=version.payload_sha256,
            exported_at_ms=version.exported_at_ms,
            if_match=if_match,
            operation="restore",
        )

    def record_operation(
        self,
        scope: str,
        operation: str,
        status: str,
        etag: str | None,
        version_id: int | None,
    ) -> None:
        with self._managed_connect() as connection:
            connection.execute(
                """
                INSERT INTO sync_operations (
                  scope, operation, status, etag, version_id, created_at_ms
                ) VALUES (?, ?, ?, ?, ?, ?);
                """,
                (scope, operation, status, etag, version_id, current_time_ms()),
            )

    def list_operations(self, scope: str, limit: int = 100) -> list[StoredOperation]:
        safe_limit = min(max(int(limit), 1), 100)
        with self._managed_connect() as connection:
            rows = connection.execute(
                """
                SELECT operation_id, scope, operation, status, etag, version_id, created_at_ms
                FROM sync_operations
                WHERE scope = ?
                ORDER BY operation_id DESC
                LIMIT ?;
                """,
                (scope, safe_limit),
            ).fetchall()
        return [
            StoredOperation(
                operation_id=row["operation_id"],
                scope=row["scope"],
                operation=row["operation"],
                status=row["status"],
                etag=row["etag"],
                version_id=row["version_id"],
                created_at_ms=row["created_at_ms"],
            )
            for row in rows
        ]


class RequestError(Exception):
    def __init__(self, status: HTTPStatus, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class PreconditionFailedError(RequestError):
    def __init__(self) -> None:
        super().__init__(
            HTTPStatus.PRECONDITION_FAILED,
            "ETAG_PRECONDITION_FAILED",
            "远端数据已更新，请先重新拉取再合并上传。",
        )


class SyncRequestHandler(BaseHTTPRequestHandler):
    server: "PassSyncHTTPServer"
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        self._dispatch(expect_body=False)

    def do_HEAD(self) -> None:
        self._dispatch(expect_body=False, head_only=True)

    def do_PUT(self) -> None:
        self._dispatch(expect_body=True)

    def do_POST(self) -> None:
        self._dispatch(expect_body=False)

    def do_OPTIONS(self) -> None:
        self._handle_options()

    def log_message(self, format: str, *args: Any) -> None:
        LOGGER.info("%s - %s", self.address_string(), format % args)

    def _dispatch(self, expect_body: bool, head_only: bool = False) -> None:
        try:
            self.server.enforce_rate_limit(self.client_address[0])
            path = self.path.split("?", 1)[0]
            if path == "/healthz":
                self._handle_healthz(head_only=head_only)
                return
            if path == "/metrics":
                self._handle_metrics(head_only=head_only)
                return
            is_payload_path = path in {"/v1/sync/payload", "/v2/sync/state"}
            is_versions_path = path in {"/v1/sync/versions", "/v2/sync/versions"}
            is_audit_path = path in {"/v1/sync/audit", "/v2/sync/audit"}
            version_id = None
            restore_version_id = None
            version_prefix = "/v2/sync/versions/" if path.startswith("/v2/sync/versions/") else "/v1/sync/versions/"
            if path.startswith(version_prefix):
                raw_version_id = path.removeprefix(version_prefix)
                if raw_version_id.endswith("/restore"):
                    raw_version_id = raw_version_id.removesuffix("/restore")
                    restore_version_id = int(raw_version_id) if raw_version_id.isdigit() else None
                if not raw_version_id.isdigit():
                    if restore_version_id is None:
                        raise RequestError(HTTPStatus.NOT_FOUND, "NOT_FOUND", "接口不存在。")
                elif restore_version_id is None:
                    version_id = int(raw_version_id)
            if not (is_payload_path or is_versions_path or is_audit_path or version_id is not None or restore_version_id is not None):
                raise RequestError(HTTPStatus.NOT_FOUND, "NOT_FOUND", "接口不存在。")

            scope = self.server.resolve_scope(self.headers.get("Authorization"))
            if is_versions_path:
                if self.command not in {"GET", "HEAD"}:
                    raise RequestError(HTTPStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "请求方法不支持。")
                self._handle_list_versions(scope=scope, head_only=head_only)
                return
            if is_audit_path:
                if self.command not in {"GET", "HEAD"}:
                    raise RequestError(HTTPStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "请求方法不支持。")
                self._handle_list_audit(scope=scope, head_only=head_only)
                return
            if version_id is not None:
                if self.command not in {"GET", "HEAD"}:
                    raise RequestError(HTTPStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "请求方法不支持。")
                self._handle_get_version(scope=scope, version_id=version_id, head_only=head_only)
                return
            if restore_version_id is not None:
                if self.command != "POST":
                    raise RequestError(HTTPStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "请求方法不支持。")
                self._handle_restore_version(scope=scope, version_id=restore_version_id)
                return
            if self.command == "GET" or self.command == "HEAD":
                self._handle_get_payload(scope=scope, head_only=head_only)
                return
            if self.command == "PUT":
                self._handle_put_payload(scope=scope)
                return
            raise RequestError(
                HTTPStatus.METHOD_NOT_ALLOWED,
                "METHOD_NOT_ALLOWED",
                "请求方法不支持。",
            )
        except RequestError as error:
            self.server.record_error()
            self._send_json(
                error.status,
                {"error": error.code, "message": error.message},
                head_only=head_only if expect_body is False else False,
            )
        except Exception:
            self.server.record_error()
            LOGGER.exception("Unhandled request failure")
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "INTERNAL_ERROR", "message": "服务器内部错误。"},
            )

    def _handle_options(self) -> None:
        path = self.path.split("?", 1)[0]
        version_path = path.startswith("/v1/sync/versions/") or path.startswith("/v2/sync/versions/")
        version_prefix = "/v2/sync/versions/" if path.startswith("/v2/sync/versions/") else "/v1/sync/versions/"
        version_suffix = path.removeprefix(version_prefix) if version_path else ""
        restore_path = version_suffix.endswith("/restore") and version_suffix.removesuffix("/restore").isdigit()
        if path not in {
            "/healthz",
            "/metrics",
            "/v1/sync/payload",
            "/v2/sync/state",
            "/v1/sync/versions",
            "/v2/sync/versions",
            "/v1/sync/audit",
            "/v2/sync/audit",
        } and not (
            version_path and (version_suffix.isdigit() or restore_path)
        ):
            self._send_json(
                HTTPStatus.NOT_FOUND,
                {"error": "NOT_FOUND", "message": "接口不存在。"},
            )
            return
        headers = self._cors_response_headers()
        headers.update(
            {
                "Allow": "GET, HEAD, POST, PUT, OPTIONS",
                "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, OPTIONS",
                "Access-Control-Allow-Headers": self._allowed_cors_headers(),
                "Access-Control-Max-Age": "600",
                "Content-Length": "0",
            }
        )
        self.send_response(HTTPStatus.NO_CONTENT.value)
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()

    def _handle_healthz(self, head_only: bool) -> None:
        payload = {
            "ok": True,
            "service": "pass-sync-server",
            "timeMs": current_time_ms(),
        }
        self._send_json(HTTPStatus.OK, payload, head_only=head_only)

    def _handle_metrics(self, head_only: bool) -> None:
        self.server.require_metrics_token(self.headers.get("Authorization"))
        payload = self.server.metrics_snapshot()
        self._send_json(HTTPStatus.OK, payload, head_only=head_only)

    def _handle_get_payload(self, scope: str, head_only: bool) -> None:
        stored = self.server.repository.get(scope)
        if stored is None:
            raise RequestError(HTTPStatus.NOT_FOUND, "PAYLOAD_NOT_FOUND", "远端还没有同步数据。")

        body_bytes = stored.payload_json.encode("utf-8")
        headers = {
            "Content-Type": "application/json; charset=utf-8",
            "ETag": stored.etag,
            "X-Payload-Sha256": stored.payload_sha256,
            "X-Sync-Scope": scope,
            "Cache-Control": "no-store",
            "X-Sync-Revision": str(self.server.repository.current_revision(scope)),
        }
        self._send_bytes(HTTPStatus.OK, body_bytes, headers=headers, head_only=head_only)

    def _handle_list_versions(self, scope: str, head_only: bool) -> None:
        versions = self.server.repository.list_versions(scope)
        payload = {
            "scope": scope,
            "versions": [
                {
                    "versionId": item.version_id,
                    "etag": item.etag,
                    "payloadSha256": item.payload_sha256,
                    "exportedAtMs": item.exported_at_ms,
                    "updatedAtMs": item.updated_at_ms,
                    "savedAtMs": item.saved_at_ms,
                }
                for item in versions
            ],
        }
        self._send_json(HTTPStatus.OK, payload, head_only=head_only)

    def _handle_list_audit(self, scope: str, head_only: bool) -> None:
        operations = self.server.repository.list_operations(scope)
        payload = {
            "scope": scope,
            "operations": [
                {
                    "operationId": item.operation_id,
                    "operation": item.operation,
                    "status": item.status,
                    "etag": item.etag,
                    "versionId": item.version_id,
                    "createdAtMs": item.created_at_ms,
                }
                for item in operations
            ],
        }
        self._send_json(HTTPStatus.OK, payload, head_only=head_only)

    def _handle_get_version(self, scope: str, version_id: int, head_only: bool) -> None:
        stored = self.server.repository.get_version(scope, version_id)
        if stored is None:
            raise RequestError(HTTPStatus.NOT_FOUND, "VERSION_NOT_FOUND", "同步快照版本不存在。")
        body_bytes = stored.payload_json.encode("utf-8")
        headers = {
            "Content-Type": "application/json; charset=utf-8",
            "ETag": stored.etag,
            "X-Payload-Sha256": stored.payload_sha256,
            "X-Sync-Scope": scope,
            "X-Sync-Version": str(stored.version_id),
            "Cache-Control": "no-store",
        }
        self._send_bytes(HTTPStatus.OK, body_bytes, headers=headers, head_only=head_only)

    def _handle_restore_version(self, scope: str, version_id: int) -> None:
        if_match = self.headers.get("If-Match")
        if if_match is None or not if_match.strip():
            raise RequestError(
                HTTPStatus.PRECONDITION_REQUIRED,
                "IF_MATCH_REQUIRED",
                "恢复快照必须提供当前数据的 If-Match，以避免覆盖并发更新。",
            )
        restored = self.server.repository.restore_version(
            scope=scope,
            version_id=version_id,
            if_match=if_match,
        )
        if restored is None:
            raise RequestError(HTTPStatus.NOT_FOUND, "VERSION_NOT_FOUND", "同步快照版本不存在。")
        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "restoredVersionId": version_id,
                "etag": restored.etag,
                "payloadSha256": restored.payload_sha256,
                "updatedAtMs": restored.updated_at_ms,
                "revision": self.server.repository.current_revision(scope),
            },
            extra_headers={
                "ETag": restored.etag,
                "X-Payload-Sha256": restored.payload_sha256,
                "X-Sync-Scope": scope,
                "X-Sync-Version": str(version_id),
                "Cache-Control": "no-store",
            },
        )

    def _handle_put_payload(self, scope: str) -> None:
        content_length_header = self.headers.get("Content-Length")
        if content_length_header is None:
            raise RequestError(HTTPStatus.LENGTH_REQUIRED, "LENGTH_REQUIRED", "必须提供 Content-Length。")
        try:
            content_length = int(content_length_header)
        except ValueError as error:
            raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID_CONTENT_LENGTH", "Content-Length 无效。") from error
        if content_length <= 0:
            raise RequestError(HTTPStatus.BAD_REQUEST, "EMPTY_BODY", "请求体不能为空。")
        if content_length > self.server.config.max_body_bytes:
            raise RequestError(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "PAYLOAD_TOO_LARGE",
                f"请求体不能超过 {self.server.config.max_body_bytes} 字节。",
            )
        raw_body = self.rfile.read(content_length)
        if len(raw_body) != content_length:
            raise RequestError(HTTPStatus.BAD_REQUEST, "INCOMPLETE_BODY", "请求体长度与 Content-Length 不一致。")
        payload_json, payload_sha256, exported_at_ms = parse_and_validate_bundle(
            raw_body,
            allow_plaintext=self.server.config.allow_plaintext,
        )
        idempotency_key = self.headers.get("Idempotency-Key", "").strip() or None
        if idempotency_key is not None and len(idempotency_key) > 200:
            raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 过长。")
        stored = self.server.repository.put(
            scope=scope,
            payload_json=payload_json,
            payload_sha256=payload_sha256,
            exported_at_ms=exported_at_ms,
            if_match=self.headers.get("If-Match"),
            idempotency_key=idempotency_key,
        )
        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "etag": stored.etag,
                "payloadSha256": stored.payload_sha256,
                "updatedAtMs": stored.updated_at_ms,
                "revision": self.server.repository.current_revision(scope),
            },
            extra_headers={
                "ETag": stored.etag,
                "X-Payload-Sha256": stored.payload_sha256,
                "X-Sync-Scope": scope,
                "X-Sync-Revision": str(self.server.repository.current_revision(scope)),
                "Cache-Control": "no-store",
            },
        )

    def _send_json(
        self,
        status: HTTPStatus,
        payload: dict[str, Any],
        *,
        head_only: bool = False,
        extra_headers: dict[str, str] | None = None,
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        headers = {"Content-Type": "application/json; charset=utf-8"}
        if extra_headers:
            headers.update(extra_headers)
        self._send_bytes(status, body, headers=headers, head_only=head_only)

    def _send_bytes(
        self,
        status: HTTPStatus,
        body: bytes,
        *,
        headers: dict[str, str] | None = None,
        head_only: bool = False,
    ) -> None:
        self.send_response(status.value)
        for key, value in self._cors_response_headers().items():
            self.send_header(key, value)
        if headers:
            for key, value in headers.items():
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _allowed_cors_headers(self) -> str:
        requested = self.headers.get("Access-Control-Request-Headers", "")
        allowlist = {"authorization", "content-type", "if-match", "idempotency-key", "accept"}
        normalized = []
        for item in requested.split(","):
            name = item.strip().lower()
            if name and name in allowlist and name not in normalized:
                normalized.append(name)
        if not normalized:
            normalized = ["authorization", "content-type", "if-match", "accept"]
        return ", ".join(normalized)

    def _cors_response_headers(self) -> dict[str, str]:
        origin = self.headers.get("Origin", "").strip()
        if not origin or origin not in self.server.config.allowed_origins:
            return {}
        return {
            "Access-Control-Allow-Origin": origin,
            "Vary": "Origin",
        }


class PassSyncHTTPServer(ThreadingHTTPServer):
    # Do not let an idle HTTP/1.1 client connection block process shutdown.
    daemon_threads = True
    block_on_close = False

    def __init__(self, server_address: tuple[str, int], handler_cls: type[BaseHTTPRequestHandler], config: AppConfig):
        super().__init__(server_address, handler_cls)
        self.config = config
        self.repository = PayloadRepository(config.db_path)
        self._rate_lock = threading.Lock()
        self._rate_windows: dict[str, tuple[int, int]] = {}
        self._metrics_lock = threading.Lock()
        self._metrics: dict[str, int] = {"requests": 0, "errors": 0, "rateLimited": 0}

    def enforce_rate_limit(self, client: str) -> None:
        now = int(time.time() // 60)
        with self._rate_lock:
            window, count = self._rate_windows.get(client, (now, 0))
            if window != now:
                window, count = now, 0
            count += 1
            self._rate_windows[client] = (window, count)
            if count > self.config.rate_limit_per_minute:
                with self._metrics_lock:
                    self._metrics["rateLimited"] += 1
                raise RequestError(HTTPStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "请求过于频繁，请稍后重试。")
        with self._metrics_lock:
            self._metrics["requests"] += 1

    def metrics_snapshot(self) -> dict[str, object]:
        with self._metrics_lock:
            metrics = dict(self._metrics)
        metrics["dbBytes"] = self.config.db_path.stat().st_size if self.config.db_path.exists() else 0
        metrics["timeMs"] = current_time_ms()
        return {"ok": True, "service": "pass-sync-server", "metrics": metrics}

    def record_error(self) -> None:
        with self._metrics_lock:
            self._metrics["errors"] += 1

    def require_metrics_token(self, authorization_header: str | None) -> None:
        self.resolve_scope(authorization_header)

    def resolve_scope(self, authorization_header: str | None) -> str:
        if not self.config.auth_enabled:
            raise RequestError(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "AUTH_NOT_CONFIGURED",
                "服务器尚未配置 PASS_SYNC_BEARER_TOKENS。",
            )
        if not authorization_header:
            raise RequestError(HTTPStatus.UNAUTHORIZED, "AUTH_REQUIRED", "缺少 Bearer Token。")
        scheme, _, token = authorization_header.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            raise RequestError(HTTPStatus.UNAUTHORIZED, "AUTH_INVALID", "Bearer Token 格式错误。")
        scope = self.config.token_scopes.get(token.strip())
        if scope is None:
            raise RequestError(HTTPStatus.FORBIDDEN, "AUTH_FORBIDDEN", "Token 无效。")
        return scope


def parse_and_validate_bundle(raw_body: bytes, *, allow_plaintext: bool = True) -> tuple[str, str, int]:
    try:
        parsed = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID_JSON", f"JSON 解析失败: {exc}") from exc

    if not isinstance(parsed, dict):
        raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID_BUNDLE", "根节点必须是对象。")

    schema = parsed.get("schema")
    if schema not in {"pass.sync.encrypted.v1", "pass.sync.bundle.v2"}:
        raise RequestError(
            HTTPStatus.BAD_REQUEST,
            "INVALID_SCHEMA",
            "服务端仅接受 pass.sync.encrypted.v1 或 pass.sync.bundle.v2。",
        )

    if schema == "pass.sync.bundle.v2" and not allow_plaintext:
        raise RequestError(
            HTTPStatus.BAD_REQUEST,
            "PLAINTEXT_SYNC_DISABLED",
            "服务器已禁止明文同步，请在所有客户端配置同步加密密钥。",
        )

    if schema == "pass.sync.encrypted.v1":
        if parsed.get("cipher") != "AES-256-GCM":
            raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID_CIPHER", "仅支持 AES-256-GCM。")
        for field_name, minimum_bytes in (("nonceBase64", 12), ("ciphertextBase64", 17)):
            value = parsed.get(field_name)
            if not isinstance(value, str):
                raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID_ENVELOPE", f"{field_name} 必须是 Base64 字符串。")
            try:
                decoded = base64.b64decode(value, validate=True)
            except (ValueError, binascii.Error) as exc:
                raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID_ENVELOPE", f"{field_name} 不是合法 Base64。") from exc
            if len(decoded) < minimum_bytes:
                raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID_ENVELOPE", f"{field_name} 长度不足。")

    exported_at_ms = parsed.get("exportedAtMs")
    if not isinstance(exported_at_ms, int):
        raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID_BUNDLE", "exportedAtMs 必须是整数毫秒时间戳。")

    canonical_json = json.dumps(parsed, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    payload_sha256 = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    return canonical_json, payload_sha256, exported_at_ms


def etag_matches(current_etag: str | None, if_match: str | None) -> bool:
    if if_match is None or not if_match.strip():
        return True
    normalized = [item.strip() for item in if_match.split(",") if item.strip()]
    if "*" in normalized:
        return current_etag is not None
    return current_etag is not None and current_etag in normalized


def parse_token_scopes(value: str) -> dict[str, str]:
    token_scopes: dict[str, str] = {}
    for index, raw_item in enumerate(value.split(","), start=1):
        item = raw_item.strip()
        if not item:
            continue
        if "=" in item:
            scope, token = item.split("=", 1)
        else:
            scope, token = ("default" if index == 1 else f"scope{index}"), item
        scope = scope.strip() or f"scope{index}"
        token = token.strip()
        if not token:
            continue
        token_scopes[token] = scope
    return token_scopes


def current_time_ms() -> int:
    return int(time.time() * 1000)


def load_config() -> AppConfig:
    script_dir = Path(__file__).resolve().parent
    db_path = Path(os.environ.get("PASS_SYNC_DB_PATH", script_dir / "data" / "pass_sync.sqlite3")).expanduser()
    token_file = os.environ.get("PASS_SYNC_BEARER_TOKENS_FILE", "").strip()
    token_value = os.environ.get("PASS_SYNC_BEARER_TOKENS", "")
    if token_file:
        token_path = Path(token_file).expanduser()
        if token_path.is_file():
            mode = token_path.stat().st_mode & 0o777
            if mode & 0o077:
                raise RuntimeError(f"PASS_SYNC_BEARER_TOKENS_FILE 权限必须为 0600 或更严格: {token_path}")
            token_value = token_path.read_text(encoding="utf-8").strip()
        elif not token_value:
            # Keep deployment backward-compatible when a service template is
            # installed before its token file. Payload requests remain fail
            # closed with AUTH_NOT_CONFIGURED until an operator adds tokens.
            LOGGER.warning("令牌文件不存在，服务将以未配置认证状态启动: %s", token_path)
    token_scopes = parse_token_scopes(token_value)
    allowed_origins = tuple(
        sorted({origin.strip() for origin in os.environ.get("PASS_SYNC_ALLOWED_ORIGINS", "").split(",") if origin.strip()})
    )
    cert_value = os.environ.get("PASS_SYNC_TLS_CERT", "").strip()
    key_value = os.environ.get("PASS_SYNC_TLS_KEY", "").strip()
    if bool(cert_value) != bool(key_value):
        raise RuntimeError("PASS_SYNC_TLS_CERT 和 PASS_SYNC_TLS_KEY 必须同时配置")
    return AppConfig(
        host=os.environ.get("PASS_SYNC_HOST", "127.0.0.1"),
        port=int(os.environ.get("PASS_SYNC_PORT", "53333")),
        db_path=db_path,
        token_scopes=token_scopes,
        max_body_bytes=max(1024, int(os.environ.get("PASS_SYNC_MAX_BODY_BYTES", str(2 * 1024 * 1024)))),
        rate_limit_per_minute=max(10, int(os.environ.get("PASS_SYNC_RATE_LIMIT_PER_MINUTE", "120"))),
        allow_plaintext=os.environ.get("PASS_SYNC_ALLOW_PLAINTEXT", "0").strip().lower() in {"1", "true", "yes"},
        tls_cert_path=Path(cert_value).expanduser() if cert_value else None,
        tls_key_path=Path(key_value).expanduser() if key_value else None,
        allowed_origins=allowed_origins,
    )


def build_server(config: AppConfig) -> PassSyncHTTPServer:
    server = PassSyncHTTPServer((config.host, config.port), SyncRequestHandler, config)
    if config.tls_cert_path and config.tls_key_path:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(certfile=config.tls_cert_path, keyfile=config.tls_key_path)
        server.socket = context.wrap_socket(server.socket, server_side=True)
    return server


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("PASS_SYNC_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    config = load_config()
    server = build_server(config)

    def handle_signal(signum: int, _frame: Any) -> None:
        LOGGER.info("Received signal %s, shutting down.", signum)
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    LOGGER.info(
        "pass-sync-server listening on %s:%s db=%s auth=%s",
        config.host,
        config.port,
        config.db_path,
        "enabled" if config.auth_enabled else "disabled",
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
