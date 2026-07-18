#!/usr/bin/env python3
"""Verify a Pass macOS backup without exposing password fields.

The check requires pass.db and, when present, WAL/SHM and local key files.
It runs SQLite integrity_check, checks the expected encrypted collection rows,
and reports hashes/counts only. It never decrypts or prints credential data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify(directory: Path) -> dict[str, object]:
    db = directory / "pass.db"
    if not db.is_file():
        raise FileNotFoundError(db)
    key = directory / "pass-db-key-v1"
    if key.exists() and key.stat().st_size != 32:
        raise ValueError("pass-db-key-v1 must contain 32 bytes")
    with sqlite3.connect(db) as connection:
        integrity = connection.execute("PRAGMA integrity_check;").fetchone()[0]
        if integrity != "ok":
            raise ValueError(f"SQLite integrity check failed: {integrity}")
        rows = connection.execute(
            "SELECT key, length(value), updated_at_ms FROM kv ORDER BY key"
        ).fetchall()
    row_map = {str(key_name): {"bytes": int(size), "updatedAtMs": int(updated)} for key_name, size, updated in rows}
    expected = {"accounts", "folders", "passkeys", "history"}
    missing = sorted(expected - row_map.keys())
    if missing:
        raise ValueError(f"missing encrypted collections: {', '.join(missing)}")
    return {
        "directory": str(directory),
        "databaseSha256": sha256(db),
        "databaseBytes": db.stat().st_size,
        "keyPresent": key.is_file(),
        "keyBytes": key.stat().st_size if key.exists() else 0,
        "walPresent": (directory / "pass.db-wal").is_file(),
        "shmPresent": (directory / "pass.db-shm").is_file(),
        "collections": row_map,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="只读验证 Pass 本地备份")
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.directory.expanduser().resolve()), ensure_ascii=False, indent=2))
    except (OSError, sqlite3.Error, ValueError) as error:
        print(f"备份验证失败：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
