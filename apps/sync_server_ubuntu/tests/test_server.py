from __future__ import annotations

import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from pass_sync_server import AppConfig, build_server


def sample_bundle(exported_at_ms: int = 1_777_777_777_777) -> bytes:
    return json.dumps(
        {
            "schema": "pass.sync.bundle.v2",
            "exportedAtMs": exported_at_ms,
            "source": {
                "app": "pass-extension",
                "platform": "chrome-extension",
                "deviceName": "ChromeMac",
                "deviceId": "device-1",
                "logicalClockMs": exported_at_ms,
                "formatVersion": 2,
            },
            "payload": {
                "accounts": [],
                "folders": [],
                "passkeys": [],
            },
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

    def test_requires_token_when_configured(self) -> None:
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request("GET", "/v1/sync/payload")
        self.assertEqual(context.exception.code, 401)
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
        self.assertEqual(parsed["schema"], "pass.sync.bundle.v2")

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


if __name__ == "__main__":
    unittest.main()
