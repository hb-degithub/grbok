import hashlib
import http.server
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
FAKE_AGE = REPO_ROOT / "tests" / "ops" / "fakes" / "fake-age.py"
FAKE_RCLONE = REPO_ROOT / "tests" / "ops" / "fakes" / "fake-rclone.py"


class ArchiveApiState:
    def __init__(self):
        self.fail_stage = ""
        self.status = None
        self.sealed = None
        self.uploaded = None
        self.commit_calls = 0
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
                else:
                    self.send_json(404, {"code": "NOT_FOUND"})
                    return
                self.send_json(200, payload)

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    @property
    def url(self):
        return f"http://127.0.0.1:{self.httpd.server_port}/api/internal/mail-archive"

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
            }
        )

    def tearDown(self):
        self.server.__exit__(None, None, None)
        self.temp.cleanup()

    def run_archive(self, extra=None):
        env = self.env.copy()
        env.update(extra or {})
        return subprocess.run(
            [sys.executable, str(SCRIPT), "run"],
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


if __name__ == "__main__":
    unittest.main()
