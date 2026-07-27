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
import pass_sync_server as server_module  # noqa: E402
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


def plaintext_bundle(
    exported_at_ms: int,
    accounts: list[dict],
    folders: list[dict],
    *,
    all_regular_account_ids: list[str],
    folder_order_ids: list[str],
) -> bytes:
    """Build an intentionally readable V2 package for HTTP integration tests."""
    return json.dumps(
        {
            "schema": "pass.sync.bundle.v2",
            "exportedAtMs": exported_at_ms,
            "source": {
                "app": "pass-e2e-test",
                "platform": "test",
                "deviceName": "E2E",
                "deviceId": "e2e-device",
                "logicalClockMs": exported_at_ms,
                "formatVersion": 2,
            },
            "payload": {
                "accounts": accounts,
                "folders": folders,
                "passkeys": [],
                "allRegularAccountIds": all_regular_account_ids,
                "allRegularOrderUpdatedAtMs": exported_at_ms,
                "allRegularOrderUpdatedDeviceName": "E2E",
                "folderOrderIds": folder_order_ids,
                "folderOrderUpdatedAtMs": exported_at_ms,
                "folderOrderUpdatedDeviceName": "E2E",
            },
        }
    ).encode()


def account(record_id: str, updated_at_ms: int, *, permanently_deleted: bool = False) -> dict:
    return {
        "recordId": record_id,
        "accountId": record_id,
        "canonicalSite": f"{record_id}.example.test",
        "username": record_id,
        "password": "" if permanently_deleted else f"{record_id}-secret",
        "sites": [] if permanently_deleted else [f"{record_id}.example.test"],
        "folderIds": [],
        "isDeleted": permanently_deleted,
        "isPermanentlyDeleted": permanently_deleted,
        "deletedAtMs": updated_at_ms if permanently_deleted else None,
        "deletedDeviceName": "ClientA" if permanently_deleted else "",
        "createdAtMs": 1,
        "updatedAtMs": updated_at_ms,
    }


def folder(folder_id: str, regular_account_ids: list[str], updated_at_ms: int) -> dict:
    return {
        "id": folder_id,
        "name": folder_id,
        "regularAccountIds": regular_account_ids,
        "regularOrderUpdatedAtMs": updated_at_ms,
        "regularOrderUpdatedDeviceName": "E2E",
        "matchedSites": [],
        "autoAddMatchingSites": False,
        "isDeleted": False,
        "isPermanentlyDeleted": False,
        "deletedAtMs": None,
        "deletedDeviceName": "",
        "createdAtMs": 1,
        "updatedAtMs": updated_at_ms,
    }


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

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def state_request(
        self,
        method: str,
        *,
        body: bytes | None = None,
        etag: str | None = None,
        idempotency_key: str | None = None,
    ):
        headers = {"Authorization": "Bearer token"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if etag is not None:
            headers["If-Match"] = etag
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        request = urllib.request.Request(
            f"{self.base_url}/v2/sync/state",
            data=body,
            method=method,
            headers=headers,
        )
        return urllib.request.urlopen(request, timeout=5)

    def test_self_hosted_server_rejects_stale_etag(self):
        base = self.base_url
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

    def test_two_clients_retry_after_conflict_keeps_tombstone_and_scope_orders(self):
        """The server must preserve the candidate produced after a client-side re-merge."""
        baseline = plaintext_bundle(
            100,
            [account("base", 100), account("removed", 100)],
            [folder("work", ["base", "removed"], 100)],
            all_regular_account_ids=["base", "removed"],
            folder_order_ids=["work"],
        )
        with self.state_request("PUT", body=baseline, idempotency_key="initial") as response:
            initial_etag = response.headers["ETag"]
            self.assertEqual(response.headers["X-Sync-Revision"], "1")

        # Client B writes first while Client A is still working from revision 1.
        client_b_payload = plaintext_bundle(
            200,
            [account("base", 100), account("removed", 200), account("client-b", 200)],
            [folder("work", ["client-b", "base", "removed"], 200)],
            all_regular_account_ids=["client-b", "base", "removed"],
            folder_order_ids=["work"],
        )
        with self.state_request(
            "PUT",
            body=client_b_payload,
            etag=initial_etag,
            idempotency_key="client-b-write",
        ) as response:
            client_b_etag = response.headers["ETag"]
            self.assertEqual(response.headers["X-Sync-Revision"], "2")

        # Client A's old snapshot must never silently overwrite client B.
        client_a_stale_payload = plaintext_bundle(
            300,
            [account("base", 100), account("removed", 300, permanently_deleted=True), account("client-a", 300)],
            [folder("work", ["client-a", "base"], 300)],
            all_regular_account_ids=["client-a", "base"],
            folder_order_ids=["work"],
        )
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.state_request(
                "PUT",
                body=client_a_stale_payload,
                etag=initial_etag,
                idempotency_key="client-a-logical-sync",
            )
        self.assertEqual(context.exception.code, 412)
        context.exception.close()

        # After pulling revision 2, Client A's client-side merge chooses this
        # complete candidate. The HTTP layer must retain its tombstone and the
        # independently scoped account orders exactly as submitted.
        with self.state_request("GET") as response:
            self.assertEqual(response.headers["ETag"], client_b_etag)
            remote_after_b = json.loads(response.read().decode())
        self.assertEqual(
            [item["recordId"] for item in remote_after_b["payload"]["accounts"]],
            ["base", "removed", "client-b"],
        )

        merged_candidate = plaintext_bundle(
            400,
            [
                account("base", 100),
                account("client-a", 300),
                account("client-b", 200),
                account("removed", 300, permanently_deleted=True),
            ],
            [folder("work", ["client-a", "client-b", "base"], 400)],
            all_regular_account_ids=["client-a", "client-b", "base"],
            folder_order_ids=["work"],
        )
        with self.state_request(
            "PUT",
            body=merged_candidate,
            etag=client_b_etag,
            idempotency_key="client-a-logical-sync",
        ) as response:
            merged_etag = response.headers["ETag"]
            self.assertEqual(response.headers["X-Sync-Revision"], "3")

        # A lost success response retries with the same key. It must replay
        # rather than append a duplicate version.
        with self.state_request(
            "PUT",
            body=merged_candidate,
            etag=merged_etag,
            idempotency_key="client-a-logical-sync",
        ) as response:
            self.assertEqual(response.headers["ETag"], merged_etag)
            self.assertEqual(response.headers["X-Sync-Revision"], "3")

        with self.state_request("GET") as response:
            final_payload = json.loads(response.read().decode())["payload"]
        self.assertEqual(final_payload["allRegularAccountIds"], ["client-a", "client-b", "base"])
        self.assertEqual(final_payload["folders"][0]["regularAccountIds"], ["client-a", "client-b", "base"])
        tombstone = next(item for item in final_payload["accounts"] if item["recordId"] == "removed")
        self.assertTrue(tombstone["isPermanentlyDeleted"])
        self.assertEqual(tombstone["password"], "")

        with urllib.request.urlopen(
            urllib.request.Request(
                f"{self.base_url}/v2/sync/versions",
                headers={"Authorization": "Bearer token"},
            ),
            timeout=5,
        ) as response:
            versions = json.loads(response.read().decode())["versions"]
        self.assertEqual([item["revision"] for item in versions], [3, 2, 1])

    def test_retry_after_transient_server_failure_uses_one_idempotent_version(self):
        original_put = self.server.repository.put
        failures_remaining = 1

        def fail_once(*args, **kwargs):
            nonlocal failures_remaining
            if failures_remaining:
                failures_remaining -= 1
                raise server_module.RequestError(
                    server_module.HTTPStatus.SERVICE_UNAVAILABLE,
                    "TEMPORARY_FAILURE",
                    "temporary test failure",
                )
            return original_put(*args, **kwargs)

        self.server.repository.put = fail_once
        payload = plaintext_bundle(
            500,
            [account("outbox-account", 500)],
            [folder("work", ["outbox-account"], 500)],
            all_regular_account_ids=["outbox-account"],
            folder_order_ids=["work"],
        )
        try:
            with self.assertRaises(urllib.error.HTTPError) as context:
                self.state_request("PUT", body=payload, idempotency_key="outbox-retry")
            self.assertEqual(context.exception.code, 503)
            context.exception.close()

            with self.state_request("PUT", body=payload, idempotency_key="outbox-retry") as response:
                self.assertEqual(response.headers["X-Sync-Revision"], "1")
                committed_etag = response.headers["ETag"]
            with self.state_request(
                "PUT",
                body=payload,
                etag=committed_etag,
                idempotency_key="outbox-retry",
            ) as response:
                self.assertEqual(response.headers["X-Sync-Revision"], "1")
            self.assertEqual(self.server.repository.current_revision("default"), 1)
        finally:
            self.server.repository.put = original_put

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
