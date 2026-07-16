#!/usr/bin/env python3
import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile


ARCHIVE_KEYS = {
    "schema_version", "event_id", "created_at", "category", "source_kind",
    "result", "duration_ms", "attempt", "error_class",
}
CATEGORIES = {"account_verification", "account_password_reset", "account_email_change", "reader_otp", "comment_new", "comment_approved", "comment_reply", "admin_test", "ops_alert", "account_retention_notice"}
SOURCE_KINDS = {"account", "reader", "comment", "admin", "operations", "retention", "registration"}
RESULTS = {"sent", "failed"}
ERROR_CLASSES = {"NONE", "MAIL_NOT_CONFIGURED", "SMTP_AUTH", "SMTP_CONNECTION", "SMTP_TIMEOUT", "RECIPIENT_TEMPORARY", "RECIPIENT_PERMANENT", "PAYLOAD_INVALID", "RATE_LIMITED", "INTERNAL_ERROR", "GATEWAY_UNAVAILABLE", "OUTBOX_UNAVAILABLE"}
DESCRIPTOR_KEYS = {"batchId", "objectKey", "cipherSha256", "manifestSha256", "ageRecipientFingerprint", "rowCount", "cursor"}


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


def require_isolated_paths(paths, archive_work_dir, sync_root, repo_root):
    for path in paths:
        if inside(path, archive_work_dir):
            raise RestoreError("RESTORE_PATH_INSIDE_ARCHIVE_WORK_DIR")
        if inside(path, sync_root) or inside(path, repo_root):
            raise RestoreError("RESTORE_PATH_INSIDE_FORBIDDEN_ROOT")


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


def valid_hash(value):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None


def load_trusted_descriptor(path, expected_hash):
    path = pathlib.Path(path)
    if not valid_hash(expected_hash) or sha256_file(path) != expected_hash:
        raise RestoreError("RESTORE_DESCRIPTOR_HASH_MISMATCH")
    try:
        descriptor = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RestoreError("RESTORE_DESCRIPTOR_INVALID") from error
    if not isinstance(descriptor, dict) or set(descriptor) != DESCRIPTOR_KEYS:
        raise RestoreError("RESTORE_DESCRIPTOR_INVALID")
    if not re.fullmatch(r"[A-Za-z0-9_-]{8,100}", str(descriptor["batchId"])):
        raise RestoreError("RESTORE_DESCRIPTOR_INVALID")
    if not re.fullmatch(r"\d{4}-\d{2}/[A-Za-z0-9_-]+\.jsonl\.gz\.age", str(descriptor["objectKey"])):
        raise RestoreError("RESTORE_DESCRIPTOR_INVALID")
    if not valid_hash(descriptor["cipherSha256"]) or not valid_hash(descriptor["manifestSha256"]) or not valid_hash(descriptor["ageRecipientFingerprint"]):
        raise RestoreError("RESTORE_DESCRIPTOR_INVALID")
    if isinstance(descriptor["rowCount"], bool) or not isinstance(descriptor["rowCount"], int) or not 1 <= descriptor["rowCount"] <= 5000:
        raise RestoreError("RESTORE_DESCRIPTOR_INVALID")
    if not isinstance(descriptor["cursor"], str) or not 1 <= len(descriptor["cursor"]) <= 500:
        raise RestoreError("RESTORE_DESCRIPTOR_INVALID")
    return descriptor


def verify_manifest_trust(manifest_path, manifest, descriptor):
    if sha256_file(manifest_path) != descriptor["manifestSha256"]:
        raise RestoreError("RESTORE_MANIFEST_TRUST_MISMATCH")
    expected = {
        "batch_id": descriptor["batchId"],
        "object_key": descriptor["objectKey"],
        "cipher_sha256": descriptor["cipherSha256"],
        "age_recipient_fingerprint": descriptor["ageRecipientFingerprint"],
        "row_count": descriptor["rowCount"],
        "cursor": descriptor["cursor"],
    }
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise RestoreError("RESTORE_MANIFEST_TRUST_MISMATCH")


def command_for(executable, args):
    command = [str(executable)] + list(args)
    if os.name == "nt" and str(executable).lower().endswith(".py"):
        command.insert(0, sys.executable)
    return command


def command_timeout_seconds():
    try:
        value = int(os.environ.get("MAIL_ARCHIVE_RESTORE_COMMAND_TIMEOUT_SECONDS", "120"))
    except ValueError as error:
        raise RestoreError("RESTORE_COMMAND_TIMEOUT_INVALID") from error
    if not 1 <= value <= 600:
        raise RestoreError("RESTORE_COMMAND_TIMEOUT_INVALID")
    return value


def run_external(command, capture=False):
    try:
        return subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=command_timeout_seconds(),
        )
    except subprocess.TimeoutExpired as error:
        raise RestoreError("RESTORE_COMMAND_TIMEOUT") from error


def identity_fingerprint(identity):
    keygen_bin = pathlib.Path(os.environ.get("MAIL_ARCHIVE_RESTORE_AGE_KEYGEN_BIN", "/usr/bin/age-keygen"))
    if not keygen_bin.is_absolute():
        raise RestoreError("RESTORE_AGE_KEYGEN_PATH_NOT_ABSOLUTE")
    completed = run_external(command_for(keygen_bin, ["-y", str(identity)]), capture=True)
    if completed.returncode != 0:
        raise RestoreError("RESTORE_IDENTITY_INVALID")
    try:
        recipient = completed.stdout.decode("utf-8").strip()
    except UnicodeDecodeError as error:
        raise RestoreError("RESTORE_IDENTITY_INVALID") from error
    if not recipient or "\n" in recipient:
        raise RestoreError("RESTORE_IDENTITY_INVALID")
    return hashlib.sha256(recipient.encode("utf-8")).hexdigest()


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
            if row["schema_version"] != 1 or isinstance(row["schema_version"], bool):
                raise RestoreError("RESTORE_SCHEMA_INVALID")
            if not isinstance(row["event_id"], str) or re.fullmatch(r"[A-Za-z0-9_-]{8,100}", row["event_id"]) is None:
                raise RestoreError("RESTORE_SCHEMA_INVALID")
            if not isinstance(row["created_at"], str):
                raise RestoreError("RESTORE_SCHEMA_INVALID")
            try:
                parsed_created = dt.datetime.fromisoformat(row["created_at"].replace("Z", "+00:00"))
            except ValueError as error:
                raise RestoreError("RESTORE_SCHEMA_INVALID") from error
            if parsed_created.tzinfo is None:
                raise RestoreError("RESTORE_SCHEMA_INVALID")
            if row["category"] not in CATEGORIES or row["source_kind"] not in SOURCE_KINDS or row["result"] not in RESULTS or row["error_class"] not in ERROR_CLASSES:
                raise RestoreError("RESTORE_SCHEMA_INVALID")
            if isinstance(row["duration_ms"], bool) or not isinstance(row["duration_ms"], int) or not 0 <= row["duration_ms"] <= 600000:
                raise RestoreError("RESTORE_SCHEMA_INVALID")
            if isinstance(row["attempt"], bool) or not isinstance(row["attempt"], int) or not 1 <= row["attempt"] <= 20:
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
    descriptor_path = pathlib.Path(args.trusted_descriptor).resolve(strict=True)
    archive_work_dir = pathlib.Path(args.archive_work_dir).resolve(strict=True)
    sync_root = pathlib.Path(args.sync_root).resolve(strict=True)
    repo_root = pathlib.Path(args.repo_root).resolve(strict=True)
    restore_root = pathlib.Path(args.restore_root).resolve()
    require_isolated_paths((cipher, manifest_path, identity, descriptor_path, restore_root), archive_work_dir, sync_root, repo_root)
    restore_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name != "nt" and restore_root.stat().st_mode & 0o077:
        raise RestoreError("RESTORE_ROOT_PERMISSIONS")
    manifest = load_manifest(manifest_path)
    descriptor = load_trusted_descriptor(descriptor_path, args.trusted_descriptor_sha256)
    verify_manifest_trust(manifest_path, manifest, descriptor)
    if identity_fingerprint(identity) != descriptor["ageRecipientFingerprint"]:
        raise RestoreError("RESTORE_IDENTITY_FINGERPRINT_MISMATCH")
    if cipher.stat().st_size != int(manifest["cipher_size"]) or sha256_file(cipher) != descriptor["cipherSha256"]:
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
        command = command_for(age_bin, ["--decrypt", "--identity", str(identity), "--output", str(gzip_path), str(cipher)])
        completed = run_external(command)
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
        try:
            shutil.rmtree(temporary)
        except OSError as error:
            raise RestoreError("RESTORE_CLEANUP_FAILED") from error


def main(argv=None):
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--cipher", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--identity", required=True)
    parser.add_argument("--trusted-descriptor", required=True)
    parser.add_argument("--trusted-descriptor-sha256", required=True)
    parser.add_argument("--archive-work-dir", required=True)
    parser.add_argument("--sync-root", required=True)
    parser.add_argument("--repo-root", required=True)
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
