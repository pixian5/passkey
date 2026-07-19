#!/usr/bin/env python3
"""Create a consistent local macOS backup and verify its SQLite structure."""

from __future__ import annotations

import argparse
import shutil
import sqlite3
from pathlib import Path

from verify_local_backup import verify


def create_backup(source: Path, destination: Path) -> dict[str, object]:
    destination.mkdir(parents=True, exist_ok=False)
    source_db = source / "pass.db"
    target_db = destination / "pass.db"
    with sqlite3.connect(source_db) as connection:
        escaped = str(target_db).replace("'", "''")
        connection.execute(f"VACUUM INTO '{escaped}'")
    # Never copy the raw database key next to the encrypted DB. Restoring a
    # backup requires the operator to supply pass-db-key-v1 separately.
    for name in ("sync-credentials-v1.json", "app-lock-credential-v1.json"):
        path = source / name
        if path.exists():
            target = destination / name
            shutil.copy2(path, target)
            try:
                target.chmod(0o600)
            except OSError:
                pass
    note = destination / "RESTORE_KEY.txt"
    note.write_text(
        "This backup intentionally omits pass-db-key-v1.\n"
        "Restore that 32-byte key from a separate secret store before opening pass.db.\n",
        encoding="utf-8",
    )
    try:
        note.chmod(0o600)
        destination.chmod(0o700)
    except OSError:
        pass
    return verify(destination)


def main() -> int:
    parser = argparse.ArgumentParser(description="创建并验证 Pass 本地备份")
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    report = create_backup(args.source.expanduser().resolve(), args.destination.expanduser().resolve())
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
