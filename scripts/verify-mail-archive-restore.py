#!/usr/bin/env python3
import argparse
import gzip
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile


ARCHIVE_KEYS = {
    "schema_version", "event_id", "created_at", "category", "source_kind",
    "result", "duration_ms", "attempt", "error_class",
}


class RestoreError(RuntimeError):
    pass


def sha256_file(path):
    digest = hashlib.sha256()
    with pathlib.Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inside(path, parent):
    try:
        pathlib.Path(path).resolve().relative_to(pathlib.Path(parent).resolve())
        return True
    except ValueError:
        return False


def require_isolated_paths(paths, archive_work_dir):
    for path in paths:
        if inside(path, archive_work_dir):
            raise RestoreError("RESTORE_PATH_INSIDE_ARCHIVE_WORK_DIR")


def load_manifest(path):
    try:
        manifest = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RestoreError("RESTORE_MANIFEST_INVALID") from error
    required = {
        "batch_id", "cursor", "row_count", "plaintext_sha256", "gzip_sha256",
        "cipher_sha256", "cipher_size", "object_key",
    }
    if not isinstance(manifest, dict) or not required.issubset(manifest):
        raise RestoreError("RESTORE_MANIFEST_INVALID")
    return manifest


def parse_rows(plain_path, manifest):
    rows = []
    with pathlib.Path(plain_path).open("r", encoding="utf-8", newline="") as source:
        for line in source:
            try:
                row = json.loads(line)
            except json.JSONDecodeError as error:
                raise RestoreError("RESTORE_JSONL_INVALID") from error
            if not isinstance(row, dict) or set(row) != ARCHIVE_KEYS:
                raise RestoreError("RESTORE_SCHEMA_INVALID")
            rows.append(row)
    if len(rows) != int(manifest["row_count"]):
        raise RestoreError("RESTORE_ROW_COUNT_MISMATCH")
    if not rows:
        raise RestoreError("RESTORE_ROW_COUNT_MISMATCH")
    try:
        cursor = json.loads(manifest["cursor"])
    except (TypeError, json.JSONDecodeError) as error:
        raise RestoreError("RESTORE_CURSOR_INVALID") from error
    expected_cursor = {"created_at": rows[-1]["created_at"], "event_id": rows[-1]["event_id"]}
    if cursor != expected_cursor:
        raise RestoreError("RESTORE_CURSOR_MISMATCH")
    return rows


def verify_restore(args):
    cipher = pathlib.Path(args.cipher).resolve(strict=True)
    manifest_path = pathlib.Path(args.manifest).resolve(strict=True)
    identity = pathlib.Path(args.identity).resolve(strict=True)
    archive_work_dir = pathlib.Path(args.archive_work_dir).resolve(strict=True)
    restore_root = pathlib.Path(args.restore_root).resolve()
    require_isolated_paths((cipher, manifest_path, identity, restore_root), archive_work_dir)
    restore_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name != "nt" and restore_root.stat().st_mode & 0o077:
        raise RestoreError("RESTORE_ROOT_PERMISSIONS")
    manifest = load_manifest(manifest_path)
    if cipher.stat().st_size != int(manifest["cipher_size"]) or sha256_file(cipher) != manifest["cipher_sha256"]:
        raise RestoreError("RESTORE_CIPHER_HASH_MISMATCH")
    age_bin = pathlib.Path(os.environ.get("MAIL_ARCHIVE_RESTORE_AGE_BIN", "/usr/bin/age"))
    if not age_bin.is_absolute():
        raise RestoreError("RESTORE_AGE_PATH_NOT_ABSOLUTE")
    temporary = pathlib.Path(tempfile.mkdtemp(prefix="mail-archive-restore-", dir=restore_root))
    if os.name != "nt":
        temporary.chmod(0o700)
    gzip_path = temporary / "archive.jsonl.gz"
    plain_path = temporary / "archive.jsonl"
    try:
        command = [str(age_bin), "--decrypt", "--identity", str(identity), "--output", str(gzip_path), str(cipher)]
        if os.name == "nt" and str(age_bin).lower().endswith(".py"):
            command.insert(0, sys.executable)
        completed = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        if completed.returncode != 0:
            raise RestoreError("RESTORE_AGE_FAILED")
        if sha256_file(gzip_path) != manifest["gzip_sha256"]:
            raise RestoreError("RESTORE_GZIP_HASH_MISMATCH")
        try:
            with gzip_path.open("rb") as raw_source, gzip.GzipFile(fileobj=raw_source, mode="rb") as source, plain_path.open("xb") as target:
                shutil.copyfileobj(source, target)
        except (OSError, gzip.BadGzipFile) as error:
            raise RestoreError("RESTORE_GZIP_INVALID") from error
        if sha256_file(plain_path) != manifest["plaintext_sha256"]:
            raise RestoreError("RESTORE_PLAINTEXT_HASH_MISMATCH")
        rows = parse_rows(plain_path, manifest)
        return {"row_count": len(rows)}
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def main(argv=None):
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--cipher", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--identity", required=True)
    parser.add_argument("--archive-work-dir", required=True)
    parser.add_argument("--restore-root", required=True)
    args = parser.parse_args(argv)
    try:
        print(json.dumps(verify_restore(args), separators=(",", ":"), sort_keys=True))
        return 0
    except (RestoreError, OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
