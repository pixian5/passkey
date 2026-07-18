import sqlite3
import tempfile
import unittest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import verify_local_backup  # noqa: E402


class VerifyLocalBackupTests(unittest.TestCase):
    def test_valid_encrypted_collection_shape(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "pass-db-key-v1").write_bytes(b"k" * 32)
            with sqlite3.connect(root / "pass.db") as connection:
                connection.execute("CREATE TABLE kv (key TEXT PRIMARY KEY, value BLOB NOT NULL, updated_at_ms INTEGER NOT NULL)")
                for name in ("accounts", "folders", "passkeys", "history"):
                    connection.execute("INSERT INTO kv VALUES (?, ?, ?)", (name, b"\x01encrypted", 42))
                connection.commit()
            report = verify_local_backup.verify(root)
        self.assertEqual(report["keyBytes"], 32)
        self.assertEqual(report["collections"]["accounts"]["bytes"], 10)

    def test_missing_collection_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with sqlite3.connect(root / "pass.db") as connection:
                connection.execute("CREATE TABLE kv (key TEXT PRIMARY KEY, value BLOB NOT NULL, updated_at_ms INTEGER NOT NULL)")
                connection.commit()
            with self.assertRaises(ValueError):
                verify_local_backup.verify(root)


if __name__ == "__main__":
    unittest.main()
