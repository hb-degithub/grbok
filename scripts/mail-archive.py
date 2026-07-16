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
import urllib.parse
import urllib.request


class ArchiveError(RuntimeError):
    pass


MANIFEST_KEYS = frozenset({
    "schema_version", "batch_id", "min_created_at", "max_created_at", "row_count",
    "plaintext_sha256", "gzip_sha256", "cipher_sha256", "cipher_size",
    "age_recipient_fingerprints", "object_key", "sealed_at",
})


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
    age_recipients: tuple
    age_recipient_fingerprints: tuple
    rclone_remote: str
    rclone_prefix: str
    work_dir: pathlib.Path
    age_bin: str
    rclone_bin: str
    retention_mode: str
    work_dir_max_bytes: int
    command_timeout_seconds: int
    test_mode: bool
    test_fail_stage: str

    @classmethod
    def from_env(cls):
        required = [
            "MAIL_ARCHIVE_API_URL", "MAIL_ARCHIVE_HMAC_SECRET", "MAIL_ARCHIVE_RCLONE_REMOTE",
            "MAIL_ARCHIVE_RCLONE_PREFIX", "MAIL_ARCHIVE_WORK_DIR",
        ]
        plural_recipients = os.environ.get("MAIL_ARCHIVE_AGE_RECIPIENTS", "").strip()
        plural_fingerprints = os.environ.get("MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINTS", "").strip()
        if not plural_recipients and not plural_fingerprints:
            required.extend(["MAIL_ARCHIVE_AGE_RECIPIENT", "MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINT"])
        missing = [name for name in required if not os.environ.get(name)]
        if missing:
            raise ArchiveError("ARCHIVE_CONFIG_MISSING:" + ",".join(missing))
        if bool(plural_recipients) != bool(plural_fingerprints):
            raise ArchiveError("ARCHIVE_AGE_RECIPIENT_COUNT_MISMATCH")
        if plural_recipients:
            recipients = [value.strip() for value in plural_recipients.split(",")]
            fingerprints = [value.strip().lower() for value in plural_fingerprints.split(",")]
        else:
            recipients = [os.environ["MAIL_ARCHIVE_AGE_RECIPIENT"].strip()]
            fingerprints = [os.environ["MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINT"].strip().lower()]
        if not 1 <= len(recipients) <= 2 or any(not value for value in recipients):
            raise ArchiveError("ARCHIVE_AGE_RECIPIENTS_INVALID")
        if len(recipients) != len(fingerprints):
            raise ArchiveError("ARCHIVE_AGE_RECIPIENT_COUNT_MISMATCH")
        if any(re.fullmatch(r"[a-f0-9]{64}", value) is None for value in fingerprints):
            raise ArchiveError("ARCHIVE_AGE_RECIPIENT_FINGERPRINTS_INVALID")
        if len(set(recipients)) != len(recipients) or len(set(fingerprints)) != len(fingerprints):
            raise ArchiveError("ARCHIVE_AGE_RECIPIENT_DUPLICATE")
        for recipient, fingerprint in zip(recipients, fingerprints):
            if not hmac.compare_digest(recipient_fingerprint(recipient), fingerprint):
                raise ArchiveError("AGE_RECIPIENT_FINGERPRINT_MISMATCH")
        ordered_pairs = sorted(zip(fingerprints, recipients))
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
        retention_mode = os.environ.get("MAIL_ARCHIVE_RETENTION_MODE", "")
        if retention_mode != "s3-versioned":
            raise ArchiveError("ARCHIVE_RETENTION_MODE_UNSUPPORTED")
        try:
            work_dir_max_bytes = int(os.environ.get("MAIL_ARCHIVE_WORK_DIR_MAX_BYTES", str(1024 * 1024 * 1024)))
        except ValueError as error:
            raise ArchiveError("ARCHIVE_WORK_DIR_CAPACITY_INVALID") from error
        if work_dir_max_bytes < 1:
            raise ArchiveError("ARCHIVE_WORK_DIR_CAPACITY_INVALID")
        try:
            command_timeout_seconds = int(os.environ.get("MAIL_ARCHIVE_COMMAND_TIMEOUT_SECONDS", "120"))
        except ValueError as error:
            raise ArchiveError("ARCHIVE_COMMAND_TIMEOUT_INVALID") from error
        if not 1 <= command_timeout_seconds <= 600:
            raise ArchiveError("ARCHIVE_COMMAND_TIMEOUT_INVALID")
        return cls(
            api_url=api_url,
            hmac_secret=secret,
            age_recipients=tuple(pair[1] for pair in ordered_pairs),
            age_recipient_fingerprints=tuple(pair[0] for pair in ordered_pairs),
            rclone_remote=remote,
            rclone_prefix=prefix,
            work_dir=work_dir,
            age_bin=age_bin,
            rclone_bin=rclone_bin,
            retention_mode=retention_mode,
            work_dir_max_bytes=work_dir_max_bytes,
            command_timeout_seconds=command_timeout_seconds,
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
        base_path = urllib.parse.urlsplit(self.config.api_url).path.rstrip("/")
        path = base_path + "/" + operation
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
    try:
        completed = subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=config.command_timeout_seconds,
        )
    except subprocess.TimeoutExpired as error:
        raise ArchiveError("ARCHIVE_COMMAND_TIMEOUT") from error
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
        "gzip_sha256", "cipher_sha256", "cipher_size", "age_recipient_fingerprints",
        "object_key", "sealed_at",
    ]
    manifest = {"schema_version": 1}
    for key in keys:
        if key not in batch or batch[key] in (None, ""):
            raise ArchiveError("ARCHIVE_MANIFEST_FIELD_MISSING")
        manifest[key] = batch[key]
    return manifest


def verify_remote_manifest(raw, batch):
    try:
        manifest = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ArchiveError("ARCHIVE_REMOTE_MANIFEST_INVALID") from error
    if not isinstance(manifest, dict) or set(manifest) != MANIFEST_KEYS:
        raise ArchiveError("ARCHIVE_REMOTE_MANIFEST_INVALID")
    if manifest != manifest_for(batch):
        raise ArchiveError("ARCHIVE_REMOTE_MANIFEST_MISMATCH")
    return manifest


def commit_uploaded(api, config, batch):
    cipher = remote_bytes(config, batch["object_key"])
    if sha256_bytes(cipher) != batch["cipher_sha256"]:
        raise ArchiveError("ARCHIVE_REMOTE_HASH_MISMATCH")
    manifest_key = batch["object_key"] + ".manifest.json"
    manifest = remote_bytes(config, manifest_key)
    if sha256_bytes(manifest) != batch["manifest_sha256"]:
        raise ArchiveError("ARCHIVE_REMOTE_MANIFEST_MISMATCH")
    verify_remote_manifest(manifest, batch)
    return api.post("commit", {
        "batch_id": batch["batch_id"], "cipher_sha256": batch["cipher_sha256"],
        "object_key": batch["object_key"], "manifest_sha256": batch["manifest_sha256"],
    })


def work_dir_size(work_dir):
    total = 0
    for path in pathlib.Path(work_dir).rglob("*"):
        if path.is_symlink():
            raise ArchiveError("ARCHIVE_WORK_DIR_SYMLINK_REJECTED")
        if path.is_file():
            total += path.stat().st_size
    return total


def require_capacity(config):
    if work_dir_size(config.work_dir) > config.work_dir_max_bytes:
        raise ArchiveError("ARCHIVE_WORK_DIR_CAPACITY_EXCEEDED")


def cleanup_startup_plaintext(config):
    pattern = re.compile(r"^[A-Za-z0-9_-]{8,100}\.jsonl(?:\.gz)?(?:\.tmp)?$")
    for path in config.work_dir.iterdir():
        if path.is_symlink():
            raise ArchiveError("ARCHIVE_WORK_DIR_SYMLINK_REJECTED")
        if path.is_file() and pattern.fullmatch(path.name):
            try:
                path.unlink()
            except OSError as error:
                raise ArchiveError("ARCHIVE_PLAINTEXT_CLEANUP_FAILED") from error


def cleanup_committed_ciphers(api, config, now):
    cutoff = now - dt.timedelta(hours=24)
    pattern = re.compile(r"^([A-Za-z0-9_-]{8,100})\.jsonl\.gz\.age$")
    for path in config.work_dir.glob("*.jsonl.gz.age"):
        match = pattern.fullmatch(path.name)
        if not match:
            raise ArchiveError("ARCHIVE_LOCAL_CIPHER_NAME_INVALID")
        status = api.post("status", {"batch_id": match.group(1)})
        if status.get("batch_id") != match.group(1):
            raise ArchiveError("ARCHIVE_STATUS_BATCH_MISMATCH")
        if status.get("status") != "committed":
            continue
        try:
            committed_at = dt.datetime.fromisoformat(str(status.get("committed_at") or "").replace("Z", "+00:00"))
        except ValueError as error:
            raise ArchiveError("ARCHIVE_COMMITTED_AT_INVALID") from error
        if committed_at <= cutoff:
            try:
                path.unlink()
            except OSError as error:
                raise ArchiveError("ARCHIVE_COMMITTED_CIPHER_CLEANUP_FAILED") from error


def commit_and_remove_local_cipher(api, config, batch):
    result = commit_uploaded(api, config, batch)
    if result.get("status") != "committed":
        raise ArchiveError("ARCHIVE_COMMIT_RESPONSE_INVALID")
    cipher_path = config.work_dir / f"{batch['batch_id']}.jsonl.gz.age"
    try:
        cipher_path.unlink()
    except FileNotFoundError:
        pass
    except OSError as error:
        raise ArchiveError("ARCHIVE_COMMITTED_CIPHER_CLEANUP_FAILED") from error
    return result


def run_archive(config):
    api = ApiClient(config)
    cleanup_committed_ciphers(api, config, dt.datetime.now(dt.timezone.utc))
    require_capacity(config)
    pending = api.post("status", {})
    if pending.get("empty"):
        pending = api.post("prepare", {"limit": 5000})
    if pending.get("empty"):
        return {"empty": True}
    if not pending.get("batch_id"):
        raise ArchiveError("ARCHIVE_STATUS_BATCH_INVALID")
    status = pending.get("status")
    if status == "uploaded":
        return commit_and_remove_local_cipher(api, config, pending)
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
            cipher_tmp = cipher_path.with_name(cipher_path.name + ".tmp")
            try:
                age_args = []
                for recipient in config.age_recipients:
                    age_args.extend(["--recipient", recipient])
                age_args.extend(["--output", str(cipher_tmp), str(gzip_path)])
                run_command(config, config.age_bin, age_args)
                os.replace(cipher_tmp, cipher_path)
            finally:
                try:
                    cipher_tmp.unlink()
                except FileNotFoundError:
                    pass
            cipher_hash = sha256_file(cipher_path)
            require_capacity(config)
            month = str(batch["max_created_at"])[:7]
            object_key = f"{month}/{batch_id}.jsonl.gz.age"
            seal_input = {
                "batch_id": batch_id, "plaintext_sha256": plaintext_hash, "gzip_sha256": gzip_hash,
                "cipher_sha256": cipher_hash, "cipher_size": cipher_path.stat().st_size,
                "age_recipient_fingerprints": list(config.age_recipient_fingerprints), "object_key": object_key,
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

    refreshed = api.post("status", {"batch_id": batch_id})
    if not refreshed.get("empty"):
        if refreshed.get("batch_id") != batch_id:
            raise ArchiveError("ARCHIVE_STATUS_BATCH_MISMATCH")
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
    return commit_and_remove_local_cipher(api, config, batch)


def utc_iso(value):
    return value.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def validate_retention_item(item):
    required = {"batchId", "maxCreatedAt", "objectKey", "cipherSha256", "manifestObjectKey"}
    if not isinstance(item, dict) or set(item) != required:
        raise ArchiveError("ARCHIVE_RETENTION_DTO_INVALID")
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", str(item["batchId"])):
        raise ArchiveError("ARCHIVE_RETENTION_BATCH_INVALID")
    object_key = str(item["objectKey"])
    if not re.fullmatch(r"\d{4}-\d{2}/[A-Za-z0-9_-]+\.jsonl\.gz\.age", object_key):
        raise ArchiveError("ARCHIVE_RETENTION_OBJECT_INVALID")
    if item["manifestObjectKey"] != object_key + ".manifest.json":
        raise ArchiveError("ARCHIVE_RETENTION_MANIFEST_INVALID")
    if not re.fullmatch(r"[a-f0-9]{64}", str(item["cipherSha256"])):
        raise ArchiveError("ARCHIVE_RETENTION_HASH_INVALID")
    try:
        dt.datetime.fromisoformat(str(item["maxCreatedAt"]).replace("Z", "+00:00"))
    except ValueError as error:
        raise ArchiveError("ARCHIVE_RETENTION_DATE_INVALID") from error
    return item


def verify_retention_manifest(raw, item):
    try:
        manifest = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ArchiveError("ARCHIVE_RETENTION_MANIFEST_INVALID") from error
    expected = {
        "batch_id": item["batchId"],
        "object_key": item["objectKey"],
        "cipher_sha256": item["cipherSha256"],
    }
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise ArchiveError("ARCHIVE_RETENTION_MANIFEST_MISMATCH")


def s3_version_name_matches(candidate, base_name):
    if candidate == base_name:
        return True
    if "." not in base_name:
        return False
    stem, extension = base_name.rsplit(".", 1)
    pattern = re.escape(stem) + r"-v\d{4}-\d{2}-\d{2}-\d{6}-\d{3}\." + re.escape(extension)
    return re.fullmatch(pattern, candidate) is not None


def list_s3_logical_paths(config, object_key):
    path = pathlib.PurePosixPath(object_key)
    parent = str(path.parent)
    completed = run_command(config, config.rclone_bin, [
        "lsjson", remote_spec(config, parent), "--s3-versions", "--s3-version-deleted", "--recursive",
    ], capture=True)
    try:
        rows = json.loads(completed.stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ArchiveError("ARCHIVE_RETENTION_LIST_INVALID") from error
    if not isinstance(rows, list) or len(rows) > 10000:
        raise ArchiveError("ARCHIVE_RETENTION_LIST_INVALID")
    matches = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("Path"), str):
            raise ArchiveError("ARCHIVE_RETENTION_LIST_INVALID")
        listed = pathlib.PurePosixPath(row["Path"])
        if listed.is_absolute() or len(listed.parts) != 1 or listed.parts[0] in ("", ".", ".."):
            raise ArchiveError("ARCHIVE_RETENTION_LIST_UNSAFE")
        if row.get("IsDir"):
            continue
        if s3_version_name_matches(listed.name, path.name):
            matches.append(str(path.parent / listed.name))
    return sorted(set(matches))


def purge_s3_logical_object(config, object_key):
    for _attempt in range(5):
        matches = list_s3_logical_paths(config, object_key)
        if not matches:
            return
        for exact_path in matches:
            run_command(config, config.rclone_bin, [
                "deletefile", remote_spec(config, exact_path), "--s3-versions", "--s3-version-deleted",
            ])
    if list_s3_logical_paths(config, object_key):
        raise ArchiveError("ARCHIVE_RETENTION_RESIDUAL_OBJECT")


def purge_retention_item(config, item):
    cipher = remote_bytes(config, item["objectKey"], allow_missing=True)
    if cipher is not None and sha256_bytes(cipher) != item["cipherSha256"]:
        raise ArchiveError("ARCHIVE_RETENTION_CIPHER_MISMATCH")
    manifest = remote_bytes(config, item["manifestObjectKey"], allow_missing=True)
    if manifest is not None:
        verify_retention_manifest(manifest, item)

    for object_key in (item["objectKey"], item["manifestObjectKey"]):
        if config.retention_mode != "s3-versioned":
            raise ArchiveError("ARCHIVE_RETENTION_MODE_UNSUPPORTED")
        purge_s3_logical_object(config, object_key)

    for object_key in (item["objectKey"], item["manifestObjectKey"]):
        if list_s3_logical_paths(config, object_key):
            raise ArchiveError("ARCHIVE_RETENTION_RESIDUAL_OBJECT")


def run_retention(config):
    api = ApiClient(config)
    cutoff = utc_iso(dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=90))
    cursor = None
    deleted = 0
    while True:
        request = {"cutoffIso": cutoff, "limit": 100}
        if cursor:
            request["cursor"] = cursor
        page = api.post("retention-due", request)
        if not isinstance(page, dict) or not isinstance(page.get("items"), list):
            raise ArchiveError("ARCHIVE_RETENTION_RESPONSE_INVALID")
        for raw_item in page["items"]:
            item = validate_retention_item(raw_item)
            purge_retention_item(config, item)
            api.post("retention-confirm", {
                "batchId": item["batchId"],
                "objectKey": item["objectKey"],
                "cipherSha256": item["cipherSha256"],
            })
            deleted += 1
        cursor = page.get("cursor")
        if not cursor:
            break
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", str(cursor)):
            raise ArchiveError("ARCHIVE_RETENTION_CURSOR_INVALID")
    return {"retained": deleted}


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv not in (["run"], ["retention"]):
        print("usage: mail-archive.py {run|retention}", file=sys.stderr)
        return 2
    try:
        config = Config.from_env()
        cleanup_startup_plaintext(config)
        if argv == ["run"]:
            result = run_archive(config)
            retention = run_retention(config)
            output = {"status": result.get("status", "empty"), "retained": retention["retained"]}
        else:
            result = run_retention(config)
            output = {"retained": result["retained"]}
        print(canonical_json(output))
        return 0
    except ArchiveError as error:
        print(str(error), file=sys.stderr)
        return 1
    except OSError:
        print("ARCHIVE_LOCAL_IO_FAILED", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
