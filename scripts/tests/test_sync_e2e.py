import hashlib
import json
import sys
import threading
import urllib.error
import urllib.request
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "apps" / "sync_server_ubuntu"))
from pass_sync_server import AppConfig, build_server  # noqa: E402


def bundle(exported_at_ms: int) -> bytes:
    return json.dumps(
        {
            "schema": "pass.sync.encrypted.v1",
            "exportedAtMs": exported_at_ms,
            "cipher": "AES-256-GCM",
            "nonceBase64": "AAAAAAAAAAAAAAAA",
            "ciphertextBase64": "AAAAAAAAAAAAAAAAAAAAAAAA",
        }
    ).encode()


class WebDAVState:
    body: bytes | None = None
    etag: str | None = None
    emit_etag = True


class WebDAVHandler(BaseHTTPRequestHandler):
    state = WebDAVState()
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        return

    def do_GET(self):
        if self.state.body is None:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(200)
        if self.state.emit_etag:
            self.send_header("ETag", self.state.etag)
        self.send_header("Content-Length", str(len(self.state.body)))
        self.end_headers()
        self.wfile.write(self.state.body)

    def do_PUT(self):
        if_match = self.headers.get("If-Match")
        if if_match and if_match != self.state.etag:
            self.send_response(412)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        self.state.body = self.rfile.read(length)
        self.state.etag = f'"{hashlib.sha256(self.state.body).hexdigest()}"'
        self.send_response(200)
        if self.state.emit_etag:
            self.send_header("ETag", self.state.etag)
        self.send_header("Content-Length", "0")
        self.end_headers()


class SyncEndToEndTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = TemporaryDirectory()
        self.server = build_server(
            AppConfig(
                host="127.0.0.1",
                port=0,
                db_path=Path(self.temp_dir.name) / "sync.sqlite3",
                token_scopes={"token": "default"},
            )
        )
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        self.webdav = ThreadingHTTPServer(("127.0.0.1", 0), WebDAVHandler)
        WebDAVHandler.state = WebDAVState()
        self.webdav_thread = threading.Thread(target=self.webdav.serve_forever, daemon=True)
        self.webdav_thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server_thread.join(timeout=5)
        self.webdav.shutdown()
        self.webdav.server_close()
        self.webdav_thread.join(timeout=5)
        self.temp_dir.cleanup()

    def test_self_hosted_server_rejects_stale_etag(self):
        base = f"http://127.0.0.1:{self.server.server_address[1]}"
        headers = {"Authorization": "Bearer token", "Content-Type": "application/json"}
        request = urllib.request.Request(f"{base}/v1/sync/payload", data=bundle(1), method="PUT", headers=headers)
        with urllib.request.urlopen(request) as response:
            etag = response.headers["ETag"]
        request = urllib.request.Request(
            f"{base}/v1/sync/payload",
            data=bundle(2),
            method="PUT",
            headers={**headers, "If-Match": etag},
        )
        urllib.request.urlopen(request).close()
        stale = urllib.request.Request(
            f"{base}/v1/sync/payload",
            data=bundle(3),
            method="PUT",
            headers={**headers, "If-Match": etag},
        )
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(stale)
        self.assertEqual(context.exception.code, 412)
        context.exception.close()

    def test_webdav_etag_and_legacy_no_etag_modes(self):
        url = f"http://127.0.0.1:{self.webdav.server_address[1]}/pass.json"
        first = urllib.request.Request(url, data=bundle(10), method="PUT")
        with urllib.request.urlopen(first) as response:
            etag = response.headers["ETag"]
        second = urllib.request.Request(url, data=bundle(20), method="PUT", headers={"If-Match": etag})
        urllib.request.urlopen(second).close()
        stale = urllib.request.Request(url, data=bundle(30), method="PUT", headers={"If-Match": etag})
        with self.assertRaises(urllib.error.HTTPError) as context:
            urllib.request.urlopen(stale)
        self.assertEqual(context.exception.code, 412)
        context.exception.close()

        WebDAVHandler.state.emit_etag = False
        legacy = urllib.request.Request(url, data=bundle(40), method="PUT")
        with urllib.request.urlopen(legacy) as response:
            self.assertIsNone(response.headers.get("ETag"))
        with urllib.request.urlopen(urllib.request.Request(url)) as response:
            self.assertIsNone(response.headers.get("ETag"))
            self.assertEqual(json.loads(response.read().decode())["exportedAtMs"], 40)


if __name__ == "__main__":
    unittest.main()
