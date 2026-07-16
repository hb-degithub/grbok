import hashlib
import http.server
import gzip
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "mail-archive.py"
RESTORE_SCRIPT = REPO_ROOT / "scripts" / "verify-mail-archive-restore.py"
FAKE_AGE = REPO_ROOT / "tests" / "ops" / "fakes" / "fake-age.py"
FAKE_RCLONE = REPO_ROOT / "tests" / "ops" / "fakes" / "fake-rclone.py"


class ArchiveApiState:
    def __init__(self):
        self.fail_stage = ""
        self.status = None
        self.sealed = None
        self.uploaded = None
        self.commit_calls = 0
        self.retention_items = []
        self.retention_confirm_calls = []
        self.batch_id = "batch-fixture-0000000001"
        self.rows = [
            {
                "schema_version": 1,
                "event_id": "event-fixture-0001",
                "created_at": "2026-04-01T00:00:00.000Z",
                "category": "account_verification",
                "source_kind": "account",
                "result": "sent",
                "duration_ms": 42,
                "attempt": 1,
                "error_class": "NONE",
            },
            {
                "schema_version": 1,
                "event_id": "event-fixture-0002",
                "created_at": "2026-04-01T00:01:00.000Z",
                "category": "reader_otp",
                "source_kind": "reader",
                "result": "failed",
                "duration_ms": 51,
                "attempt": 2,
                "error_class": "SMTP_TIMEOUT",
            },
        ]

    def reset(self):
        self.__init__()

    def prepared(self):
        payload = {
            "batch_id": self.batch_id,
            "status": self.status or "prepared",
            "row_count": len(self.rows),
            "cursor": json.dumps({"created_at": self.rows[-1]["created_at"], "event_id": self.rows[-1]["event_id"]}, separators=(",", ":")),
            "min_created_at": self.rows[0]["created_at"],
            "max_created_at": self.rows[-1]["created_at"],
        }
        if self.sealed:
            payload.update(self.sealed)
            payload["sealed_at"] = "2026-07-16T12:00:00.000Z"
        if self.uploaded:
            payload.update(self.uploaded)
        return payload


class ApiServer:
    def __init__(self):
        self.state = ArchiveApiState()
        state = self.state

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *_args):
                return

            def send_json(self, status, payload):
                encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length) or b"{}")
                stage = self.path.rsplit("/", 1)[-1]
                if state.fail_stage == stage:
                    self.send_json(503, {"code": "INJECTED_" + stage.upper()})
                    return
                if stage == "status":
                    payload = state.prepared() if state.status and state.status != "committed" else {"empty": True}
                elif stage == "prepare":
                    if state.status == "committed":
                        payload = {"empty": True}
                    else:
                        state.status = state.status or "prepared"
                        payload = state.prepared()
                elif stage == "export":
                    payload = dict(state.prepared(), rows=state.rows)
                elif stage == "seal":
                    state.sealed = body
                    state.status = "sealed"
                    payload = {"batch_id": state.batch_id, "status": "sealed"}
                elif stage == "uploaded":
                    state.uploaded = body
                    state.status = "uploaded"
                    payload = {"batch_id": state.batch_id, "status": "uploaded"}
                elif stage == "commit":
                    state.commit_calls += 1
                    state.status = "committed"
                    payload = {"batch_id": state.batch_id, "status": "committed", "deleted": len(state.rows)}
                elif stage == "retention-due":
                    limit = min(max(int(body.get("limit", 100)), 1), 100)
                    cursor = body.get("cursor") or ""
                    candidates = [item for item in state.retention_items if item["batchId"] > cursor]
                    page = candidates[:limit]
                    payload = {"items": page, "cursor": page[-1]["batchId"] if len(candidates) > limit else None}
                elif stage == "retention-confirm":
                    state.retention_confirm_calls.append(body)
                    state.retention_items = [item for item in state.retention_items if item["batchId"] != body.get("batchId")]
                    payload = {"batchId": body.get("batchId"), "status": "retention_confirmed", "idempotent": False}
                else:
                    self.send_json(404, {"code": "NOT_FOUND"})
                    return
                self.send_json(200, payload)

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def url(self):
        return f"http://127.0.0.1:{self.httpd.server_port}/api/blog-internal/mail-archive"

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_args):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)


class MailArchivePipelineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.workdir = self.root / "work"
        self.remote = self.root / "remote"
        self.workdir.mkdir(mode=0o700)
        self.remote.mkdir(mode=0o700)
        self.server = ApiServer()
        self.server.__enter__()
        recipient = "age1fixturepublicrecipient000000000000000000000000000000000"
        self.env = os.environ.copy()
        self.env.update(
            {
                "PYTHONUTF8": "1",
                "MAIL_ARCHIVE_TEST_MODE": "1",
                "MAIL_ARCHIVE_API_URL": self.server.url,
                "MAIL_ARCHIVE_HMAC_SECRET": "fixture-hmac-secret-with-more-than-thirty-two-chars",
                "MAIL_ARCHIVE_AGE_RECIPIENT": recipient,
                "MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINT": hashlib.sha256(recipient.encode()).hexdigest(),
                "MAIL_ARCHIVE_RCLONE_REMOTE": "fixture-remote",
                "MAIL_ARCHIVE_RCLONE_PREFIX": "mail-audit",
                "MAIL_ARCHIVE_WORK_DIR": str(self.workdir),
                "MAIL_ARCHIVE_AGE_BIN": str(FAKE_AGE),
                "MAIL_ARCHIVE_RCLONE_BIN": str(FAKE_RCLONE),
                "FAKE_RCLONE_ROOT": str(self.remote),
                "MAIL_ARCHIVE_RETENTION_MODE": "s3-versioned",
            }
        )

    def tearDown(self):
        self.server.__exit__(None, None, None)
        self.temp.cleanup()

    def run_archive(self, extra=None, args=None):
        env = self.env.copy()
        env.update(extra or {})
        return subprocess.run(
            [sys.executable, str(SCRIPT)] + list(args or ["run"]),
            cwd=REPO_ROOT,
            env=env,
            text=True,
            encoding="utf-8",
            errors="replace",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
        )

    def assert_no_plaintext(self):
        self.assertEqual(list(self.workdir.rglob("*.jsonl")), [])
        self.assertEqual(list(self.workdir.rglob("*.jsonl.gz")), [])

    def reset_run_state(self):
        self.server.state.reset()
        for item in list(self.workdir.iterdir()):
            if item.is_file():
                item.unlink()
        for item in sorted(self.remote.rglob("*"), reverse=True):
            if item.is_file():
                item.unlink()
            elif item.is_dir():
                item.rmdir()

    def test_success_encrypts_uploads_verifies_and_commits(self):
        result = self.run_archive()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.server.state.commit_calls, 1)
        self.assertEqual(self.server.state.status, "committed")
        self.assertIsNotNone(self.server.state.sealed)
        self.assertIsNotNone(self.server.state.uploaded)
        self.assertEqual(len(list(self.remote.rglob("*.age"))), 1)
        self.assertEqual(len(list(self.remote.rglob("*.manifest.json"))), 1)
        self.assert_no_plaintext()

    def test_every_failure_keeps_database_uncommitted_and_removes_plaintext(self):
        cases = [
            ("prepare", {"FAKE_API_FAIL_STAGE": "prepare"}),
            ("export", {"FAKE_API_FAIL_STAGE": "export"}),
            ("jsonl", {"MAIL_ARCHIVE_TEST_FAIL_STAGE": "jsonl"}),
            ("gzip", {"MAIL_ARCHIVE_TEST_FAIL_STAGE": "gzip"}),
            ("fingerprint", {"MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINT": "0" * 64}),
            ("age", {"FAKE_AGE_MODE": "fail"}),
            ("seal", {"FAKE_API_FAIL_STAGE": "seal"}),
            ("rclone-upload", {"FAKE_RCLONE_MODE": "fail-copy"}),
            ("rclone-readback", {"FAKE_RCLONE_MODE": "fail-cat"}),
            ("manifest", {"FAKE_RCLONE_MODE": "fail-manifest"}),
            ("uploaded", {"FAKE_API_FAIL_STAGE": "uploaded"}),
            ("commit", {"FAKE_API_FAIL_STAGE": "commit"}),
        ]
        for name, extra in cases:
            with self.subTest(stage=name):
                self.reset_run_state()
                self.server.state.fail_stage = extra.pop("FAKE_API_FAIL_STAGE", "")
                result = self.run_archive(extra)
                self.assertNotEqual(result.returncode, 0, f"{name} unexpectedly passed")
                self.assertEqual(self.server.state.commit_calls, 0, f"{name} called commit")
                self.assert_no_plaintext()

    def test_existing_remote_cipher_mismatch_stops_without_overwrite(self):
        object_path = self.remote / "mail-audit" / "2026-04" / f"{self.server.state.batch_id}.jsonl.gz.age"
        object_path.parent.mkdir(parents=True)
        object_path.write_bytes(b"unexpected-existing-cipher")
        before = object_path.read_bytes()
        result = self.run_archive()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(object_path.read_bytes(), before)
        self.assertEqual(self.server.state.commit_calls, 0)
        self.assert_no_plaintext()

    def test_uploaded_batch_resumes_by_remote_readback_then_commits(self):
        self.server.state.fail_stage = "commit"
        first = self.run_archive()
        self.assertNotEqual(first.returncode, 0)
        self.assertEqual(self.server.state.status, "uploaded")
        self.server.state.fail_stage = ""
        second = self.run_archive()
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(self.server.state.commit_calls, 1)
        self.assert_no_plaintext()

    def test_retention_deletes_only_api_authorized_due_objects_versions_and_trash(self):
        due_key = "2026-03/retention-due-0001.jsonl.gz.age"
        due_cipher = b"due-ciphertext"
        due_manifest_key = due_key + ".manifest.json"
        due = {
            "batchId": "retention-due-0001",
            "maxCreatedAt": "2026-03-01T00:00:00.000Z",
            "objectKey": due_key,
            "cipherSha256": hashlib.sha256(due_cipher).hexdigest(),
            "manifestObjectKey": due_manifest_key,
        }
        due_manifest = (json.dumps({
            "schema_version": 1,
            "batch_id": due["batchId"],
            "object_key": due_key,
            "cipher_sha256": due["cipherSha256"],
        }, separators=(",", ":")) + "\n").encode("utf-8")
        self.server.state.retention_items = [due]
        protected = [
            "2026-03/uncommitted-0001.jsonl.gz.age",
            "2026-07/not-due-0001.jsonl.gz.age",
        ]
        for relative, payload in [(due_key, due_cipher), (due_manifest_key, due_manifest)]:
            target = self.remote / "mail-audit" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
            for hidden in (".versions", ".trash"):
                historical = self.remote / hidden / "mail-audit" / relative
                historical.parent.mkdir(parents=True, exist_ok=True)
                historical.write_bytes(payload + hidden.encode("ascii"))
        for relative in protected:
            target = self.remote / "mail-audit" / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"must-remain")

        result = self.run_archive(args=["retention"])

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.server.state.retention_confirm_calls, [{
            "batchId": due["batchId"], "objectKey": due_key, "cipherSha256": due["cipherSha256"],
        }])
        for relative in (due_key, due_manifest_key):
            self.assertFalse((self.remote / "mail-audit" / relative).exists())
            self.assertFalse((self.remote / ".versions" / "mail-audit" / relative).exists())
            self.assertFalse((self.remote / ".trash" / "mail-audit" / relative).exists())
        for relative in protected:
            self.assertTrue((self.remote / "mail-audit" / relative).is_file())

    def test_retention_failure_never_confirms_remote_deletion(self):
        key = "2026-03/retention-failure-0001.jsonl.gz.age"
        cipher = b"retention-failure"
        target = self.remote / "mail-audit" / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(cipher)
        manifest = target.with_name(target.name + ".manifest.json")
        manifest.write_bytes(b"{}\n")
        self.server.state.retention_items = [{
            "batchId": "retention-failure-0001",
            "maxCreatedAt": "2026-03-01T00:00:00.000Z",
            "objectKey": key,
            "cipherSha256": hashlib.sha256(cipher).hexdigest(),
            "manifestObjectKey": key + ".manifest.json",
        }]

        result = self.run_archive({"FAKE_RCLONE_MODE": "fail-retention-purge"}, ["retention"])

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.server.state.retention_confirm_calls, [])

    def test_restore_verifies_all_hashes_schema_count_and_cursor_then_cleans_plaintext(self):
        archived = self.run_archive()
        self.assertEqual(archived.returncode, 0, archived.stderr)
        cipher = next(self.remote.rglob("*.jsonl.gz.age"))
        manifest = next(self.remote.rglob("*.manifest.json"))
        identity = self.root / "offline-age-identity.txt"
        identity.write_text("AGE-SECRET-KEY-TEST-ONLY\n", encoding="utf-8")
        restore_root = self.root / "isolated-restore"
        restore_root.mkdir(mode=0o700)
        env = self.env.copy()
        env["MAIL_ARCHIVE_RESTORE_AGE_BIN"] = str(FAKE_AGE)

        result = subprocess.run(
            [sys.executable, str(RESTORE_SCRIPT), "--cipher", str(cipher), "--manifest", str(manifest),
             "--identity", str(identity), "--archive-work-dir", str(self.workdir), "--restore-root", str(restore_root)],
            cwd=REPO_ROOT, env=env, text=True, encoding="utf-8", errors="replace",
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"row_count": len(self.server.state.rows)})
        self.assertEqual(list(restore_root.iterdir()), [])
        cipher_bytes = cipher.read_bytes()
        self.assertTrue(cipher_bytes.startswith(b"FAKE-AGE-V1\n"))
        rows = [json.loads(line) for line in gzip.decompress(cipher_bytes.split(b"\n", 1)[1]).decode("utf-8").splitlines()]
        allowed = {"schema_version", "event_id", "created_at", "category", "source_kind", "result", "duration_ms", "attempt", "error_class"}
        self.assertTrue(all(set(row) == allowed for row in rows))
        forbidden = ("secret@example.com", "s***@example.com", "email-hash-fixture", "ip-hash-fixture", "source-record-fixture", "token-fixture", "otp-fixture", "user-agent-fixture", "smtp-response-fixture", "free-text-fixture")
        serialized = json.dumps(rows, ensure_ascii=False).lower()
        self.assertFalse(any(term in serialized for term in forbidden))

    def test_restore_refuses_identity_inside_archive_work_directory(self):
        identity = self.workdir / "forbidden-identity.txt"
        identity.write_text("AGE-SECRET-KEY-TEST-ONLY\n", encoding="utf-8")
        cipher = self.root / "fixture.age"
        manifest = self.root / "fixture.manifest.json"
        cipher.write_bytes(b"invalid")
        manifest.write_text("{}", encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(RESTORE_SCRIPT), "--cipher", str(cipher), "--manifest", str(manifest),
             "--identity", str(identity), "--archive-work-dir", str(self.workdir), "--restore-root", str(self.root / "restore")],
            cwd=REPO_ROOT, env=dict(self.env, MAIL_ARCHIVE_RESTORE_AGE_BIN=str(FAKE_AGE)),
            text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("RESTORE_PATH_INSIDE_ARCHIVE_WORK_DIR", result.stderr)


if __name__ == "__main__":
    unittest.main()
