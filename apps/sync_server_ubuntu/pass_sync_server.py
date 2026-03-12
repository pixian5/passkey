#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import logging
import os
import signal
import sqlite3
import threading
import time
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

    def _initialize(self) -> None:
        with self._connect() as connection:
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

    def get(self, scope: str) -> StoredPayload | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT scope, etag, payload_json, payload_sha256, exported_at_ms, updated_at_ms
                FROM payloads
                WHERE scope = ?1
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

    def put(
        self,
        scope: str,
        payload_json: str,
        payload_sha256: str,
        exported_at_ms: int,
        if_match: str | None,
    ) -> StoredPayload:
        next_etag = f"\"{payload_sha256}\""
        now_ms = current_time_ms()

        with self._write_lock:
            current = self.get(scope)
            if not etag_matches(current.etag if current else None, if_match):
                raise PreconditionFailedError()

            with self._connect() as connection:
                connection.execute(
                    """
                    INSERT INTO payloads (
                      scope,
                      etag,
                      payload_json,
                      payload_sha256,
                      exported_at_ms,
                      updated_at_ms
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                    ON CONFLICT(scope) DO UPDATE SET
                      etag = excluded.etag,
                      payload_json = excluded.payload_json,
                      payload_sha256 = excluded.payload_sha256,
                      exported_at_ms = excluded.exported_at_ms,
                      updated_at_ms = excluded.updated_at_ms;
                    """,
                    (scope, next_etag, payload_json, payload_sha256, exported_at_ms, now_ms),
                )

            return StoredPayload(
                scope=scope,
                etag=next_etag,
                payload_json=payload_json,
                payload_sha256=payload_sha256,
                exported_at_ms=exported_at_ms,
                updated_at_ms=now_ms,
            )


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

    def log_message(self, format: str, *args: Any) -> None:
        LOGGER.info("%s - %s", self.address_string(), format % args)

    def _dispatch(self, expect_body: bool, head_only: bool = False) -> None:
        try:
            path = self.path.split("?", 1)[0]
            if path == "/healthz":
                self._handle_healthz(head_only=head_only)
                return
            if path != "/v1/sync/payload":
                raise RequestError(HTTPStatus.NOT_FOUND, "NOT_FOUND", "接口不存在。")

            scope = self.server.resolve_scope(self.headers.get("Authorization"))
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
            self._send_json(
                error.status,
                {"error": error.code, "message": error.message},
                head_only=head_only if expect_body is False else False,
            )
        except Exception:
            LOGGER.exception("Unhandled request failure")
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "INTERNAL_ERROR", "message": "服务器内部错误。"},
            )

    def _handle_healthz(self, head_only: bool) -> None:
        payload = {
            "ok": True,
            "service": "pass-sync-server",
            "timeMs": current_time_ms(),
        }
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
        }
        self._send_bytes(HTTPStatus.OK, body_bytes, headers=headers, head_only=head_only)

    def _handle_put_payload(self, scope: str) -> None:
        content_length = int(self.headers.get("Content-Length", "0") or "0")
        raw_body = self.rfile.read(content_length)
        if not raw_body:
            raise RequestError(HTTPStatus.BAD_REQUEST, "EMPTY_BODY", "请求体不能为空。")
        payload_json, payload_sha256, exported_at_ms = parse_and_validate_bundle(raw_body)
        stored = self.server.repository.put(
            scope=scope,
            payload_json=payload_json,
            payload_sha256=payload_sha256,
            exported_at_ms=exported_at_ms,
            if_match=self.headers.get("If-Match"),
        )
        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "etag": stored.etag,
                "payloadSha256": stored.payload_sha256,
                "updatedAtMs": stored.updated_at_ms,
            },
            extra_headers={
                "ETag": stored.etag,
                "X-Payload-Sha256": stored.payload_sha256,
                "X-Sync-Scope": scope,
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
        if headers:
            for key, value in headers.items():
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head_only:
            self.wfile.write(body)


class PassSyncHTTPServer(ThreadingHTTPServer):
    def __init__(self, server_address: tuple[str, int], handler_cls: type[BaseHTTPRequestHandler], config: AppConfig):
        super().__init__(server_address, handler_cls)
        self.config = config
        self.repository = PayloadRepository(config.db_path)

    def resolve_scope(self, authorization_header: str | None) -> str:
        if not self.config.auth_enabled:
            return "default"
        if not authorization_header:
            raise RequestError(HTTPStatus.UNAUTHORIZED, "AUTH_REQUIRED", "缺少 Bearer Token。")
        scheme, _, token = authorization_header.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            raise RequestError(HTTPStatus.UNAUTHORIZED, "AUTH_INVALID", "Bearer Token 格式错误。")
        scope = self.config.token_scopes.get(token.strip())
        if scope is None:
            raise RequestError(HTTPStatus.FORBIDDEN, "AUTH_FORBIDDEN", "Token 无效。")
        return scope


def parse_and_validate_bundle(raw_body: bytes) -> tuple[str, str, int]:
    try:
        parsed = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID_JSON", f"JSON 解析失败: {exc}") from exc

    if not isinstance(parsed, dict):
        raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID_BUNDLE", "根节点必须是对象。")
    if parsed.get("schema") != "pass.sync.bundle.v2":
        raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID_SCHEMA", "仅支持 pass.sync.bundle.v2。")

    payload = parsed.get("payload")
    if not isinstance(payload, dict):
        raise RequestError(HTTPStatus.BAD_REQUEST, "INVALID_PAYLOAD", "payload 必须是对象。")

    for field_name in ("accounts", "folders", "passkeys"):
        if not isinstance(payload.get(field_name), list):
            raise RequestError(
                HTTPStatus.BAD_REQUEST,
                "INVALID_PAYLOAD",
                f"payload.{field_name} 必须是数组。",
            )

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
    token_scopes = parse_token_scopes(os.environ.get("PASS_SYNC_BEARER_TOKENS", ""))
    return AppConfig(
        host=os.environ.get("PASS_SYNC_HOST", "0.0.0.0"),
        port=int(os.environ.get("PASS_SYNC_PORT", "8787")),
        db_path=db_path,
        token_scopes=token_scopes,
    )


def build_server(config: AppConfig) -> PassSyncHTTPServer:
    return PassSyncHTTPServer((config.host, config.port), SyncRequestHandler, config)


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
