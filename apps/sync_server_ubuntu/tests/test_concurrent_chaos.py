from __future__ import annotations

import base64
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pass_sync_server import AppConfig, build_server

KEY_ID_1 = "k1-1111222233334444"
KEY_ID_2 = "k1-aaaabbbbccccdddd"


def make_payload(version: int, device: str, secret_val: str, key_id: str = KEY_ID_1) -> bytes:
    # 构造合规的 AES-256-GCM 信封载荷
    encoded_secret = secret_val.encode("utf-8")
    if len(encoded_secret) < 17:
        encoded_secret = encoded_secret.ljust(17, b"~")
    return json.dumps({
        "schema": "pass.sync.encrypted.v1",
        "cipher": "AES-256-GCM",
        "exportedAtMs": 1_700_000_000_000 + version,
        "keyId": key_id,
        "nonceBase64": base64.b64encode(b"N" * 12).decode("ascii"),
        "ciphertextBase64": base64.b64encode(encoded_secret).decode("ascii"),
    }).encode("utf-8")


class ConcurrentSyncChaosTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        config = AppConfig(
            host="127.0.0.1",
            port=0,
            db_path=Path(self.temp_dir.name) / "sync.sqlite3",
            token_scopes={"token-user-1": "default"},
            allow_plaintext=True,
            allowed_origins=("chrome-extension://test",),
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

    def request(
        self,
        method: str,
        path: str,
        body: bytes | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, bytes, dict[str, str]]:
        req_headers = {"Authorization": "Bearer token-user-1"}
        if headers:
            req_headers.update(headers)
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers=req_headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request) as response:
                status = response.status
                data = response.read()
                resp_headers = dict(response.headers)
                return status, data, resp_headers
        except urllib.error.HTTPError as error:
            data = error.read()
            resp_headers = dict(error.headers)
            error.close()
            return error.code, data, resp_headers

    def test_concurrent_put_conflict_leads_to_412_and_successful_pull_merge_convergence(self) -> None:
        """两台设备基于同一 revision 并发提交，必有一方触发 412，拉取合并重试后最终收敛。"""
        # 1. 初始空库，Client A 建立 baseline (revision 1)
        status, _, headers = self.request(
            "PUT",
            "/v1/sync/payload",
            body=make_payload(1, "device-A", "account-A"),
            headers={"Content-Type": "application/json", "Idempotency-Key": "init-op-1"},
        )
        self.assertIn(status, (200, 201))
        initial_etag = headers.get("ETag")
        self.assertTrue(initial_etag)

        # 2. Client A 和 Client B 同时基于 initial_etag 提交不同修改
        barrier = threading.Barrier(2)

        def worker_put(device: str, secret: str, op_id: str):
            barrier.wait()
            return self.request(
                "PUT",
                "/v1/sync/payload",
                body=make_payload(2, device, secret),
                headers={
                    "Content-Type": "application/json",
                    "If-Match": initial_etag,
                    "Idempotency-Key": op_id,
                },
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            future_a = executor.submit(worker_put, "device-A", "account-A-new", "op-A-2")
            future_b = executor.submit(worker_put, "device-B", "account-B-new", "op-B-2")
            res_a = future_a.result()
            res_b = future_b.result()

        status_codes = {res_a[0], res_b[0]}
        # 必须恰好一个成功 (200)，另一个因 If-Match 失配触发 412 (Precondition Failed)
        self.assertIn(200, status_codes)
        self.assertIn(412, status_codes)

        winner_res = res_a if res_a[0] == 200 else res_b
        loser_res = res_a if res_a[0] == 412 else res_b
        loser_device = "device-A" if loser_res == res_a else "device-B"

        winner_etag = winner_res[2].get("ETag")
        self.assertTrue(winner_etag)
        self.assertNotEqual(winner_etag, initial_etag)

        # 3. 失败方 (Loser) 执行 Pull -> Merge -> Retry 闭环
        status_get, data_get, headers_get = self.request("GET", "/v1/sync/payload")
        self.assertEqual(status_get, 200)
        pulled_etag = headers_get.get("ETag")
        self.assertEqual(pulled_etag, winner_etag)

        # 模拟 Loser 本地将双方修改合并为 merged_secret，并使用 pulled_etag 重试
        merged_payload = make_payload(3, loser_device, "account-merged-A-and-B")
        status_retry, _, headers_retry = self.request(
            "PUT",
            "/v1/sync/payload",
            body=merged_payload,
            headers={
                "Content-Type": "application/json",
                "If-Match": pulled_etag,
                "Idempotency-Key": f"retry-{loser_device}-3",
            },
        )
        self.assertEqual(status_retry, 200)
        final_etag = headers_retry.get("ETag")
        self.assertTrue(final_etag)
        self.assertNotEqual(final_etag, pulled_etag)

        # 4. 验证最终远端已稳定收敛在合并版本，版本历史严格自增
        status_final, data_final, headers_final = self.request("GET", "/v1/sync/payload")
        self.assertEqual(status_final, 200)
        self.assertEqual(headers_final.get("ETag"), final_etag)
        final_json = json.loads(data_final.decode("utf-8"))
        decoded_ciphertext = base64.b64decode(final_json["ciphertextBase64"]).decode("utf-8")
        self.assertIn("account-merged-A-and-B", decoded_ciphertext)

    def test_key_rotation_during_concurrent_retry_preserves_consistency(self) -> None:
        """Client A 在并发窗口内完成密钥轮换，Client B 携带旧密钥拉取并重构新密钥后提交，零数据丢失。"""
        # 1. 初始为 KEY_ID_1
        _, _, headers = self.request(
            "PUT",
            "/v1/sync/payload",
            body=make_payload(1, "device-A", "secret-v1", key_id=KEY_ID_1),
            headers={"Content-Type": "application/json", "Idempotency-Key": "init-key-1"},
        )
        etag_1 = headers["ETag"]

        # 2. Client A 轮换主密钥为 KEY_ID_2，生成新同步包并提交
        status_rot, _, headers_rot = self.request(
            "PUT",
            "/v1/sync/payload",
            body=make_payload(2, "device-A", "secret-rotated-by-A", key_id=KEY_ID_2),
            headers={
                "Content-Type": "application/json",
                "If-Match": etag_1,
                "Idempotency-Key": "rotate-A-2",
            },
        )
        self.assertEqual(status_rot, 200)
        etag_rot = headers_rot["ETag"]

        # 3. Client B 不知情，尝试用旧的 etag_1 推送 KEY_ID_1 的修改，必定被拒 (412)
        status_b, _, _ = self.request(
            "PUT",
            "/v1/sync/payload",
            body=make_payload(2, "device-B", "secret-from-B", key_id=KEY_ID_1),
            headers={
                "Content-Type": "application/json",
                "If-Match": etag_1,
                "Idempotency-Key": "op-B-stale",
            },
        )
        self.assertEqual(status_b, 412)

        # 4. Client B 执行拉取：拿到用 KEY_ID_2 加密的远端包
        status_get, data_b, headers_get = self.request("GET", "/v1/sync/payload")
        self.assertEqual(status_get, 200)
        self.assertEqual(headers_get["ETag"], etag_rot)
        pulled_doc = json.loads(data_b.decode("utf-8"))
        self.assertEqual(pulled_doc["keyId"], KEY_ID_2)

        # Client B 本地同时持有旧密钥与新协商密钥，完成合并后用 KEY_ID_2 推送
        merged_doc = make_payload(3, "device-B", "secret-B-merged-with-A", key_id=KEY_ID_2)
        status_b_retry, _, headers_b_retry = self.request(
            "PUT",
            "/v1/sync/payload",
            body=merged_doc,
            headers={
                "Content-Type": "application/json",
                "If-Match": etag_rot,
                "Idempotency-Key": "retry-B-v2",
            },
        )
        self.assertEqual(status_b_retry, 200)

        # 5. 校验最终结果为 KEY_ID_2 且包含合并内容
        _, final_body, _ = self.request("GET", "/v1/sync/payload")
        final_doc = json.loads(final_body.decode("utf-8"))
        self.assertEqual(final_doc["keyId"], KEY_ID_2)
        decoded_ciphertext = base64.b64decode(final_doc["ciphertextBase64"]).decode("utf-8")
        self.assertIn("secret-B-merged-with-A", decoded_ciphertext)

    def test_outbox_retry_with_identical_idempotency_key_is_strictly_idempotent(self) -> None:
        """相同 Idempotency-Key 重放测试：网络抖动重发不生成冗余版本。"""
        # 初始提交
        status_1, data_1, hdrs_1 = self.request(
            "PUT",
            "/v1/sync/payload",
            body=make_payload(1, "device-A", "data-1"),
            headers={"Content-Type": "application/json", "Idempotency-Key": "fixed-idempotency-key"},
        )
        self.assertIn(status_1, (200, 201))
        etag_1 = hdrs_1["ETag"]

        # 模拟客户端网络丢包未收到响应，使用完全相同的 Idempotency-Key 重新发送
        status_2, data_2, hdrs_2 = self.request(
            "PUT",
            "/v1/sync/payload",
            body=make_payload(1, "device-A", "data-1"),
            headers={"Content-Type": "application/json", "Idempotency-Key": "fixed-idempotency-key"},
        )
        self.assertEqual(status_2, 200)
        self.assertEqual(hdrs_2["ETag"], etag_1)
        self.assertEqual(data_2, data_1)

        # 检查版本审计历史：版本列表中仅存在 1 条记录，无冗余版本
        status_audit, data_audit, _ = self.request("GET", "/v1/sync/versions")
        self.assertEqual(status_audit, 200)
        versions_list = json.loads(data_audit.decode("utf-8"))["versions"]
        self.assertEqual(len(versions_list), 1)

    def test_missing_if_match_on_existing_remote_payload_returns_428(self) -> None:
        """远端已有 payload 时，客户端若不携带 If-Match，必须拒绝并返回 428 Precondition Required。"""
        # 写入一条基础记录
        status_init, _, _ = self.request(
            "PUT",
            "/v1/sync/payload",
            body=make_payload(1, "device-A", "data-1"),
            headers={"Content-Type": "application/json", "Idempotency-Key": "op-init"},
        )
        self.assertIn(status_init, (200, 201))

        # 不传 If-Match 直接覆盖
        status_blind, data_blind, _ = self.request(
            "PUT",
            "/v1/sync/payload",
            body=make_payload(2, "device-B", "data-blind-overwrite"),
            headers={"Content-Type": "application/json", "Idempotency-Key": "op-blind"},
        )
        self.assertEqual(status_blind, 428)
        self.assertIn("IF_MATCH_REQUIRED", data_blind.decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
