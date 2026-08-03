import json
import gc
import sqlite3
import tempfile
import unittest
import warnings
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import audit_sync_data  # noqa: E402


class AuditSyncDataTests(unittest.TestCase):
    def test_json_summary_reports_structure_without_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bundle.json"
            path.write_text(
                json.dumps({
                    "accounts": [{"password": "must-not-be-output", "updatedAtMs": 42}],
                    "folders": [],
                }),
                encoding="utf-8",
            )
            report = audit_sync_data.summarize_json(path)
        self.assertEqual(report["counts"], {"accounts": 1})
        self.assertEqual(report["maxUpdatedAtMs"], 42)
        self.assertNotIn("must-not-be-output", json.dumps(report))

    def test_sqlite_summary_counts_top_level_collections(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pass.db"
            connection = sqlite3.connect(path)
            try:
                connection.execute("CREATE TABLE kv (key TEXT PRIMARY KEY, value BLOB NOT NULL, updated_at_ms INTEGER NOT NULL)")
                connection.execute(
                    "INSERT INTO kv VALUES (?, ?, ?)",
                    ("accounts", json.dumps([{"accountId": "redacted", "updatedAtMs": 99}]).encode(), 100),
                )
                connection.commit()
            finally:
                connection.close()
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always", ResourceWarning)
                report = audit_sync_data.summarize_sqlite(path)
                gc.collect()
            self.assertFalse([warning for warning in caught if issubclass(warning.category, ResourceWarning)])
        self.assertEqual(report["collections"]["accounts"]["counts"], {"accounts": 1})
        self.assertEqual(report["collections"]["accounts"]["maxUpdatedAtMs"], 99)
        self.assertNotIn("redacted", json.dumps(report))

    def test_sqlite_integrity_reports_encrypted_row_shape(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pass.db"
            connection = sqlite3.connect(path)
            try:
                connection.execute("CREATE TABLE kv (key TEXT PRIMARY KEY, value BLOB NOT NULL, updated_at_ms INTEGER NOT NULL)")
                connection.execute("INSERT INTO kv VALUES (?, ?, ?)", ("accounts", b"\x01encrypted", 100))
                connection.commit()
            finally:
                connection.close()
            with warnings.catch_warnings(record=True) as caught:
                warnings.simplefilter("always", ResourceWarning)
                report = audit_sync_data.summarize_sqlite_integrity(path)
                gc.collect()
            self.assertFalse([warning for warning in caught if issubclass(warning.category, ResourceWarning)])
        self.assertTrue(report["readable"])
        self.assertTrue(report["encryptedRows"])
        self.assertNotIn("redacted", json.dumps(report))

    def test_sqlite_integrity_rejects_empty_row_set(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pass.db"
            connection = sqlite3.connect(path)
            try:
                connection.execute("CREATE TABLE kv (key TEXT PRIMARY KEY, value BLOB NOT NULL, updated_at_ms INTEGER NOT NULL)")
                connection.commit()
            finally:
                connection.close()
            report = audit_sync_data.summarize_sqlite_integrity(path)
        self.assertTrue(report["readable"])
        self.assertFalse(report["encryptedRows"])

    def test_default_paths_include_group_container_database(self) -> None:
        paths = [str(path) for path in audit_sync_data.default_paths()]
        self.assertTrue(any("Group Containers/group.com.pass.desktop.shared/pass-mac/pass.db" in path for path in paths))


if __name__ == "__main__":
    unittest.main()
