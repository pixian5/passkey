#!/usr/bin/env python3
"""Read-only audit for local Pass data and exported sync sources.

The audit deliberately never prints field values or decrypts sync envelopes.
It reports counts, timestamps, file hashes, and structural differences only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


COLLECTION_KEYS = ("accounts", "folders", "passkeys", "history")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def max_updated_at(value: Any) -> int | None:
    values: list[int] = []

    def visit(item: Any) -> None:
        if isinstance(item, dict):
            for key, child in item.items():
                if key.lower().endswith("updatedatms") or key.lower() in {"updatedat", "updated_at_ms"}:
                    if isinstance(child, int) and not isinstance(child, bool):
                        values.append(child)
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)

    visit(value)
    return max(values) if values else None


def collection_counts(value: Any) -> dict[str, int]:
    counts: Counter[str] = Counter()

    def visit(item: Any) -> None:
        if isinstance(item, dict):
            for key, child in item.items():
                if key in COLLECTION_KEYS and isinstance(child, list):
                    counts[key] += len(child)
                visit(child)
        elif isinstance(item, list):
            for child in item:
                visit(child)

    visit(value)
    return {key: counts[key] for key in COLLECTION_KEYS if counts[key]}


def summarize_json(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {"path": str(path), "sizeBytes": path.stat().st_size, "sha256": sha256_file(path)}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        result["readable"] = False
        result["error"] = type(error).__name__
        return result
    result["readable"] = True
    if isinstance(value, dict) and value.get("schema") == "pass.sync.encrypted.v1":
        result["encryptedEnvelope"] = True
    result["counts"] = collection_counts(value)
    result["maxUpdatedAtMs"] = max_updated_at(value)
    return result


def summarize_sqlite(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {"path": str(path), "sizeBytes": path.stat().st_size, "sha256": sha256_file(path)}
    entries: dict[str, Any] = {}
    try:
        with sqlite3.connect(path) as connection:
            rows = connection.execute("SELECT key, value, updated_at_ms FROM kv ORDER BY key").fetchall()
    except (OSError, sqlite3.Error) as error:
        result["readable"] = False
        result["error"] = type(error).__name__
        return result
    for key, raw_value, updated_at_ms in rows:
        try:
            value = json.loads(bytes(raw_value).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
            entries[key] = {"readable": False, "updatedAtMs": updated_at_ms}
            continue
        counts = collection_counts(value)
        if key in COLLECTION_KEYS and isinstance(value, list):
            counts = {key: len(value)}
        entries[key] = {
            "readable": True,
            "updatedAtMs": updated_at_ms,
            "counts": counts,
            "maxUpdatedAtMs": max_updated_at(value),
        }
    result["readable"] = True
    result["collections"] = entries
    return result


def iter_candidate_files(paths: Iterable[Path]) -> Iterable[Path]:
    seen: set[Path] = set()
    for raw_path in paths:
        path = raw_path.expanduser().resolve()
        if path.is_file():
            candidates = [path]
        elif path.is_dir():
            candidates = sorted(
                item
                for item in path.rglob("*")
                if item.is_file() and (item.name.endswith(".json") or item.name.endswith(".sqlite3") or item.name == "pass.db")
            )
        else:
            continue
        for candidate in candidates:
            if candidate not in seen:
                seen.add(candidate)
                yield candidate


def audit(paths: Iterable[Path]) -> list[dict[str, Any]]:
    reports: list[dict[str, Any]] = []
    for path in iter_candidate_files(paths):
        if path.name == "pass.db" or path.name.endswith(".sqlite3"):
            reports.append(summarize_sqlite(path))
        else:
            reports.append(summarize_json(path))
    return reports


def default_paths() -> list[Path]:
    home = Path.home()
    return [
        home / "Library/Application Support/pass-mac/pass.db",
        home / "Library/Application Support/pass-mac/accounts.json",
        home / "Library/Application Support/pass-mac/passkeys.json",
        home / "Library/Application Support/Google/Chrome/Default/Local Extension Settings",
        home / "Library/Application Support/Google/Chrome/Default/IndexedDB",
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="只读审计 Pass 本地数据和导出同步包")
    parser.add_argument("paths", nargs="*", type=Path, help="要审计的文件或目录；不填则使用 macOS 默认路径")
    parser.add_argument("--json", action="store_true", dest="as_json", help="输出 JSON")
    args = parser.parse_args()
    reports = audit(args.paths or default_paths())
    if args.as_json:
        json.dump(reports, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 0
    for report in reports:
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    print(f"审计完成：{len(reports)} 个可读文件/数据库来源；未读取或解密任何密码字段。", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
