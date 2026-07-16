#!/usr/bin/env python3
import dataclasses
import datetime as dt
import gzip
import hashlib
import hmac
import json
import os
import pathlib
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.request


class ArchiveError(RuntimeError):
    pass


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with pathlib.Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def recipient_fingerprint(recipient):
    return hashlib.sha256(recipient.strip().encode("utf-8")).hexdigest()


@dataclasses.dataclass(frozen=True)
class Config:
    api_url: str
    hmac_secret: str
    age_recipient: str
    age_recipient_fingerprint: str
    rclone_remote: str
    rclone_prefix: str
    work_dir: pathlib.Path
    age_bin: str
    rclone_bin: str
    test_mode: bool
    test_fail_stage: str

    @classmethod
    def from_env(cls):
        required = [
            "MAIL_ARCHIVE_API_URL", "MAIL_ARCHIVE_HMAC_SECRET", "MAIL_ARCHIVE_AGE_RECIPIENT",
            "MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINT", "MAIL_ARCHIVE_RCLONE_REMOTE",
            "MAIL_ARCHIVE_RCLONE_PREFIX", "MAIL_ARCHIVE_WORK_DIR",
        ]
        missing = [name for name in required if not os.environ.get(name)]
        if missing:
            raise ArchiveError("ARCHIVE_CONFIG_MISSING:" + ",".join(missing))
        test_mode = os.environ.get("MAIL_ARCHIVE_TEST_MODE") == "1"
        api_url = os.environ["MAIL_ARCHIVE_API_URL"].rstrip("/")
        if not test_mode and not api_url.startswith("https://"):
            raise ArchiveError("ARCHIVE_API_HTTPS_REQUIRED")
        secret = os.environ["MAIL_ARCHIVE_HMAC_SECRET"]
        if len(secret) < 32:
            raise ArchiveError("ARCHIVE_HMAC_SECRET_TOO_SHORT")
        remote = os.environ["MAIL_ARCHIVE_RCLONE_REMOTE"]
        prefix = os.environ["MAIL_ARCHIVE_RCLONE_PREFIX"].strip("/")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", remote):
            raise ArchiveError("ARCHIVE_RCLONE_REMOTE_INVALID")
        if not re.fullmatch(r"[A-Za-z0-9._/-]+", prefix) or ".." in pathlib.PurePosixPath(prefix).parts:
            raise ArchiveError("ARCHIVE_RCLONE_PREFIX_INVALID")
        work_dir = pathlib.Path(os.environ["MAIL_ARCHIVE_WORK_DIR"])
        if not work_dir.is_absolute():
            raise ArchiveError("ARCHIVE_WORK_DIR_NOT_ABSOLUTE")
        work_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        if os.name != "nt" and (work_dir.stat().st_mode & 0o077):
            raise ArchiveError("ARCHIVE_WORK_DIR_PERMISSIONS")
        age_bin = os.environ.get("MAIL_ARCHIVE_AGE_BIN", "/usr/bin/age")
        rclone_bin = os.environ.get("MAIL_ARCHIVE_RCLONE_BIN", "/usr/bin/rclone")
        if not pathlib.Path(age_bin).is_absolute() or not pathlib.Path(rclone_bin).is_absolute():
            raise ArchiveError("ARCHIVE_BINARY_PATH_NOT_ABSOLUTE")
        return cls(
            api_url=api_url,
            hmac_secret=secret,
            age_recipient=os.environ["MAIL_ARCHIVE_AGE_RECIPIENT"].strip(),
            age_recipient_fingerprint=os.environ["MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINT"].strip().lower(),
            rclone_remote=remote,
            rclone_prefix=prefix,
            work_dir=work_dir,
            age_bin=age_bin,
            rclone_bin=rclone_bin,
            test_mode=test_mode,
            test_fail_stage=os.environ.get("MAIL_ARCHIVE_TEST_FAIL_STAGE", ""),
        )


class ApiClient:
    def __init__(self, config):
        self.config = config

    def post(self, operation, payload):
        raw = canonical_json(payload).encode("utf-8")
        timestamp = str(int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000))
        nonce = secrets.token_urlsafe(24)
        path = "/api/internal/mail-archive/" + operation
        body_hash = sha256_bytes(raw)
        canonical = "\n".join([timestamp, nonce, "POST", path, body_hash]).encode("utf-8")
        signature = hmac.new(self.config.hmac_secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()
        request = urllib.request.Request(
            self.config.api_url + "/" + operation,
            data=raw,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Archive-Timestamp": timestamp,
                "X-Archive-Nonce": nonce,
                "X-Archive-Body-SHA256": body_hash,
                "X-Archive-Signature": signature,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raise ArchiveError("ARCHIVE_API_" + operation.upper() + "_FAILED") from error
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            raise ArchiveError("ARCHIVE_API_UNAVAILABLE") from error


def command_prefix(config, executable):
    if config.test_mode and executable.lower().endswith(".py"):
        return [sys.executable, executable]
    return [executable]


def run_command(config, executable, args, capture=False, check=True):
    command = command_prefix(config, executable) + list(args)
    completed = subprocess.run(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if check and completed.returncode != 0:
        raise ArchiveError("ARCHIVE_COMMAND_FAILED")
    return completed


def atomic_write(path, data):
    path = pathlib.Path(path)
    temporary = path.with_name(path.name + ".tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(temporary, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
        raise


def write_jsonl(path, rows):
    payload = "".join(canonical_json(row) + "\n" for row in rows).encode("utf-8")
    atomic_write(path, payload)


def write_deterministic_gzip(source, target):
    temporary = target.with_name(target.name + ".tmp")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(temporary, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as raw_target:
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw_target, mtime=0) as gz_target:
                with source.open("rb") as plain:
                    while True:
                        chunk = plain.read(1024 * 1024)
                        if not chunk:
                            break
                        gz_target.write(chunk)
            raw_target.flush()
            os.fsync(raw_target.fileno())
        os.replace(temporary, target)
    except BaseException:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass
        raise


def remote_spec(config, object_key):
    return f"{config.rclone_remote}:{config.rclone_prefix}/{object_key}"


def remote_bytes(config, object_key, allow_missing=False):
    completed = run_command(config, config.rclone_bin, ["cat", remote_spec(config, object_key)], capture=True, check=False)
    if completed.returncode == 0:
        return completed.stdout
    if allow_missing and completed.returncode == 3:
        return None
    raise ArchiveError("ARCHIVE_REMOTE_READBACK_FAILED")


def upload_verified(config, local_path, object_key):
    expected = sha256_file(local_path)
    existing = remote_bytes(config, object_key, allow_missing=True)
    if existing is not None:
        if sha256_bytes(existing) != expected:
            raise ArchiveError("ARCHIVE_REMOTE_OBJECT_MISMATCH")
        return expected
    run_command(config, config.rclone_bin, ["copyto", str(local_path), remote_spec(config, object_key)])
    actual = sha256_bytes(remote_bytes(config, object_key))
    if actual != expected:
        raise ArchiveError("ARCHIVE_REMOTE_HASH_MISMATCH")
    return expected


def manifest_for(batch):
    keys = [
        "batch_id", "min_created_at", "max_created_at", "row_count", "plaintext_sha256",
        "gzip_sha256", "cipher_sha256", "cipher_size", "age_recipient_fingerprint",
        "object_key", "sealed_at",
    ]
    manifest = {"schema_version": 1}
    for key in keys:
        if key not in batch or batch[key] in (None, ""):
            raise ArchiveError("ARCHIVE_MANIFEST_FIELD_MISSING")
        manifest[key] = batch[key]
    return manifest


def commit_uploaded(api, config, batch):
    cipher = remote_bytes(config, batch["object_key"])
    if sha256_bytes(cipher) != batch["cipher_sha256"]:
        raise ArchiveError("ARCHIVE_REMOTE_HASH_MISMATCH")
    manifest_key = batch["object_key"] + ".manifest.json"
    manifest = remote_bytes(config, manifest_key)
    if sha256_bytes(manifest) != batch["manifest_sha256"]:
        raise ArchiveError("ARCHIVE_REMOTE_MANIFEST_MISMATCH")
    return api.post("commit", {
        "batch_id": batch["batch_id"], "cipher_sha256": batch["cipher_sha256"],
        "object_key": batch["object_key"], "manifest_sha256": batch["manifest_sha256"],
    })


def run_archive(config):
    api = ApiClient(config)
    pending = api.post("status", {})
    if pending.get("empty"):
        pending = api.post("prepare", {"limit": 5000})
    if pending.get("empty"):
        return {"empty": True}
    status = pending.get("status")
    if status == "uploaded":
        return commit_uploaded(api, config, pending)
    if status == "sealed":
        batch = pending
    elif status == "prepared":
        exported = api.post("export", {"batch_id": pending["batch_id"]})
        batch = dict(pending)
        batch.update(exported)
        batch_id = batch["batch_id"]
        plain_path = config.work_dir / f"{batch_id}.jsonl"
        gzip_path = config.work_dir / f"{batch_id}.jsonl.gz"
        cipher_path = config.work_dir / f"{batch_id}.jsonl.gz.age"
        try:
            if config.test_fail_stage == "jsonl":
                raise ArchiveError("ARCHIVE_INJECTED_JSONL_FAILURE")
            write_jsonl(plain_path, batch["rows"])
            plaintext_hash = sha256_file(plain_path)
            if config.test_fail_stage == "gzip":
                raise ArchiveError("ARCHIVE_INJECTED_GZIP_FAILURE")
            write_deterministic_gzip(plain_path, gzip_path)
            gzip_hash = sha256_file(gzip_path)
            actual_fingerprint = recipient_fingerprint(config.age_recipient)
            if not hmac.compare_digest(actual_fingerprint, config.age_recipient_fingerprint):
                raise ArchiveError("AGE_RECIPIENT_FINGERPRINT_MISMATCH")
            cipher_tmp = cipher_path.with_name(cipher_path.name + ".tmp")
            try:
                run_command(config, config.age_bin, ["--recipient", config.age_recipient, "--output", str(cipher_tmp), str(gzip_path)])
                os.replace(cipher_tmp, cipher_path)
            finally:
                try:
                    cipher_tmp.unlink()
                except FileNotFoundError:
                    pass
            cipher_hash = sha256_file(cipher_path)
            month = str(batch["max_created_at"])[:7]
            object_key = f"{month}/{batch_id}.jsonl.gz.age"
            seal_input = {
                "batch_id": batch_id, "plaintext_sha256": plaintext_hash, "gzip_sha256": gzip_hash,
                "cipher_sha256": cipher_hash, "cipher_size": cipher_path.stat().st_size,
                "age_recipient_fingerprint": actual_fingerprint, "object_key": object_key,
            }
            api.post("seal", seal_input)
            batch.update(seal_input)
            batch["status"] = "sealed"
        finally:
            for path in (plain_path, gzip_path):
                try:
                    path.unlink()
                except FileNotFoundError:
                    pass
    else:
        raise ArchiveError("ARCHIVE_UNSUPPORTED_BATCH_STATUS")

    batch_id = batch["batch_id"]
    cipher_path = config.work_dir / f"{batch_id}.jsonl.gz.age"
    if cipher_path.is_file():
        if sha256_file(cipher_path) != batch["cipher_sha256"]:
            raise ArchiveError("ARCHIVE_LOCAL_CIPHER_MISMATCH")
        upload_verified(config, cipher_path, batch["object_key"])
    else:
        cipher = remote_bytes(config, batch["object_key"])
        if sha256_bytes(cipher) != batch["cipher_sha256"]:
            raise ArchiveError("ARCHIVE_REMOTE_HASH_MISMATCH")

    refreshed = api.post("status", {})
    if not refreshed.get("empty"):
        batch.update(refreshed)
    manifest = manifest_for(batch)
    manifest_bytes = (canonical_json(manifest) + "\n").encode("utf-8")
    manifest_path = config.work_dir / f"{batch_id}.manifest.json"
    try:
        atomic_write(manifest_path, manifest_bytes)
        manifest_key = batch["object_key"] + ".manifest.json"
        manifest_hash = upload_verified(config, manifest_path, manifest_key)
    finally:
        try:
            manifest_path.unlink()
        except FileNotFoundError:
            pass
    uploaded = {
        "batch_id": batch_id, "cipher_sha256": batch["cipher_sha256"],
        "object_key": batch["object_key"], "manifest_sha256": manifest_hash,
    }
    api.post("uploaded", uploaded)
    batch.update(uploaded)
    batch["status"] = "uploaded"
    return commit_uploaded(api, config, batch)


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv != ["run"]:
        print("usage: mail-archive.py run", file=sys.stderr)
        return 2
    try:
        result = run_archive(Config.from_env())
        print(canonical_json({"status": result.get("status", "empty")}))
        return 0
    except ArchiveError as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

