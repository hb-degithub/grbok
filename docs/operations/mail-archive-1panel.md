# 1Panel Mail Archive Operations

The mail archive job exports only the approved delivery-audit summary, encrypts it with an age public recipient, uploads the ciphertext and minimal manifest through rclone, verifies both objects by reading them back, and only then commits deletion of the corresponding online rows.

## Host layout and permissions

Install the repository at `/opt/hlydwz/blog` and keep every archive runtime file on the host. Run these setup commands as root:

```bash
install -d -o root -g root -m 0700 /etc/hlydwz
install -d -o root -g root -m 0700 /var/lib/hlydwz/mail-archive
install -o root -g root -m 0600 /dev/null /etc/hlydwz/mail-archive.env
install -o root -g root -m 0600 /dev/null /etc/hlydwz/rclone.conf
```

The age identity is deliberately absent from this host. Store the offline identity in two separately controlled offline copies. Only the public recipient and its independently checked fingerprint belong in `/etc/hlydwz/mail-archive.env`.

Use this environment-file shape, replacing every example value locally. Never commit the completed file:

```dotenv
MAIL_ARCHIVE_API_URL=https://127.0.0.1:8090/api/internal/mail-archive
MAIL_ARCHIVE_HMAC_SECRET=replace-with-a-random-secret-of-at-least-32-characters
MAIL_ARCHIVE_AGE_RECIPIENT=age1replacewiththeapprovedpublicrecipient
MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINT=replace-with-the-lowercase-sha256-fingerprint
MAIL_ARCHIVE_RCLONE_REMOTE=mail-archive
MAIL_ARCHIVE_RCLONE_PREFIX=production/mail-audit
MAIL_ARCHIVE_WORK_DIR=/var/lib/hlydwz/mail-archive
RCLONE_CONFIG=/etc/hlydwz/rclone.conf
```

Keep `/etc/hlydwz/mail-archive.env` and `/etc/hlydwz/rclone.conf` owned by root with mode `0600`. Keep `/var/lib/hlydwz/mail-archive` owned by root with mode `0700`. Configure a dedicated rclone remote and prefix that no application container can access. Do not place rclone credentials in PocketBase, Docker Compose, command arguments, shell history, or logs.

Before enabling the schedule, compare the configured age recipient fingerprint with the value recorded in the offline key custody record. Run the configuration check without loading real credentials:

```bash
pwsh -NoProfile -File /opt/hlydwz/blog/scripts/check-mail-archive-config.ps1
```

## 1Panel scheduled task

Create a Shell Script task in 1Panel with this exact command:

```bash
/usr/bin/bash /opt/hlydwz/blog/scripts/run-mail-archive-1panel.sh
```

Run it hourly at minute 17 (`17 * * * *`) as root. The wrapper applies `umask 077`, verifies the root-only environment file, and uses `flock` on `/var/lock/hlydwz-mail-archive.lock`; an overlapping invocation exits successfully without starting a second exporter.

Enable the task only after the PocketBase archive migration and signed internal routes pass their local verification. Confirm that the public reverse proxy denies `/api/internal/mail-archive/`; only the host job may call it.

## Cloud retention and governance

Use a storage region approved for the site's data residency obligations and record the provider data-processing review before first upload. Enable encryption at rest in addition to age encryption. Configure provider lifecycle rules so current ciphertext objects, manifests, prior versions, delete markers, and trash are all removed after 90 days. A version-history or trash policy that keeps recoverable copies beyond 90 days is not acceptable.

The archive client makes its own committed-batch retention decision from `max_created_at`; provider lifecycle is a backstop. Review the bucket monthly for orphaned versions, trash, unexpected prefixes, public access, and policy drift.

## Monitoring and response

Alert when any of these conditions occurs:

- The hourly task has no successful run for 3 hours.
- A batch remains `prepared`, `sealed`, or `uploaded` for more than 2 hours.
- Online delivery rows older than 8 days remain uncommitted.
- Ciphertext or manifest readback hashes differ.
- The work directory contains `.jsonl` or `.jsonl.gz` after a run.
- Cloud objects, versions, or trash remain after their 90-day eligibility date.

On failure, preserve the PocketBase rows and batch state. Do not manually delete online rows, overwrite a same-name remote object, print payloads, or copy plaintext out of the mode-`0700` work directory. Correct the configuration or provider fault and rerun the same job so it resumes the earliest incomplete batch.

## Monthly isolated restore drill

Once each month, select one committed batch, download its ciphertext and manifest to a newly created isolated directory, and use the offline restore verifier with an explicitly supplied age identity. The restore directory must not be inside `/var/lib/hlydwz/mail-archive`, the rclone sync tree, or the repository.

Record only the batch identifier, verified row count, verification time, operator, and pass/fail result. Never record decrypted rows. The verifier must confirm cipher, gzip, and plaintext hashes, gzip integrity, JSONL schema, row count, and cursor, then remove all decrypted material on exit. Investigate any failure before the next scheduled deletion or retention purge.
