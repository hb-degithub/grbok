# 1Panel Mail Archive Operations

The mail archive job exports only the approved delivery-audit summary, encrypts it for one or two age public recipients, uploads the ciphertext and minimal manifest through rclone, verifies both objects by reading them back, and only then commits deletion of the corresponding online rows.

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
MAIL_ARCHIVE_API_URL=https://127.0.0.1:8090/api/blog-internal/mail-archive
MAIL_ARCHIVE_HMAC_SECRET=replace-with-a-random-secret-of-at-least-32-characters
MAIL_ARCHIVE_AGE_RECIPIENT=age1replacewiththeapprovedpublicrecipient
MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINT=replace-with-the-lowercase-sha256-fingerprint
MAIL_ARCHIVE_RCLONE_REMOTE=mail-archive
MAIL_ARCHIVE_RCLONE_PREFIX=production/mail-audit
MAIL_ARCHIVE_WORK_DIR=/var/lib/hlydwz/mail-archive
MAIL_ARCHIVE_WORK_DIR_MAX_BYTES=1073741824
MAIL_ARCHIVE_COMMAND_TIMEOUT_SECONDS=120
MAIL_ARCHIVE_RETENTION_MODE=s3-versioned
RCLONE_CONFIG=/etc/hlydwz/rclone.conf
```

The singular pair remains supported for normal operation. During key rotation, replace it with the plural pair below. Each comma-separated list must contain one or two non-empty, unique entries; counts and positions must match. Fingerprints are lowercase SHA-256 values of the corresponding public recipient. Do not configure both old and new private identities on this host.

```dotenv
MAIL_ARCHIVE_AGE_RECIPIENTS=age1oldapprovedpublicrecipient,age1newapprovedpublicrecipient
MAIL_ARCHIVE_AGE_RECIPIENT_FINGERPRINTS=old-lowercase-sha256-fingerprint,new-lowercase-sha256-fingerprint
```

The client validates every pair, orders the trusted fingerprint array deterministically, and passes one fixed `--recipient` argument group per public recipient to age. Keep both offline identities under their existing separate controls during the overlap. After new archives have been verified with either offline identity and all archives requiring the old key have expired, remove the old pair and return to a one-recipient configuration. Never place an age identity or private key in this file.

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

Run it hourly at minute 17 (`17 * * * *`) as root. The wrapper applies `umask 077`, verifies the root-only environment file, and uses `flock` on `/var/lock/hlydwz-mail-archive.lock`; an overlapping invocation exits successfully without starting a second exporter. Once locked, every invocation removes crash-left final `.jsonl`, `.jsonl.gz`, and matching temporary plaintext before its first archive API call. Ciphertext `.jsonl.gz.age` files are never part of this startup plaintext scan.

Enable the task only after the PocketBase archive migration and signed internal routes pass their local verification. Confirm that the public reverse proxy denies `/api/blog-internal/mail-archive/`; only the host job may call it.

## Cloud retention and governance

Use a storage region approved for the site's data residency obligations and record the provider data-processing review before first upload. Enable encryption at rest in addition to age encryption. Configure provider lifecycle rules so current ciphertext objects, manifests, prior versions, delete markers, and trash are all removed after 90 days. A version-history or trash policy that keeps recoverable copies beyond 90 days is not acceptable.

The archive client requests retention candidates from the signed `retention-due` API. PocketBase returns only committed batches whose `max_created_at` is strictly older than 90 days, in stable pages of at most 100. For each ciphertext and manifest, the host lists the flat month parent with `lsjson --s3-versions --s3-version-deleted --recursive`, accepts only the exact current filename or rclone's strict `-vYYYY-MM-DD-HHMMSS-mmm` version/delete-marker form, and deletes every returned path individually. It then repeats the listing until no current object, version, or delete marker matches. Only after this proof does it call `retention-confirm`. PocketBase rechecks the committed state, event-time cutoff, object key, and cipher hash transactionally, deletes the complete batch metadata, and retains only a private `{batch_id, confirmed_at, expires_at}` idempotency tombstone for seven days. Scheduled cleanup removes expired tombstones. A local host file is never authoritative for deletion.

`MAIL_ARCHIVE_RETENTION_MODE=s3-versioned` is the supported production mode for a versioned S3-compatible remote. Validate the selected provider against the pinned rclone release in staging before enabling deletion. The hourly `run` command performs both archive progress and due retention; the separate `retention` command exists for controlled retries. Provider lifecycle is a backstop, not the authority for early deletion. Review the bucket monthly for orphaned versions, trash, unexpected prefixes, public access, and policy drift.

## Monitoring and response

Alert when any of these conditions occurs:

- The hourly task has no successful run for 3 hours.
- A batch remains `prepared`, `sealed`, or `uploaded` for more than 2 hours.
- Online delivery rows older than 8 days remain uncommitted.
- Ciphertext or manifest readback hashes differ.
- The work directory contains `.jsonl` or `.jsonl.gz` after a run.
- Temporary `.jsonl.tmp` or `.jsonl.gz.tmp` files cannot be removed at startup.
- Work-directory usage exceeds `MAIL_ARCHIVE_WORK_DIR_MAX_BYTES`.
- An age or rclone command reaches the fixed `MAIL_ARCHIVE_COMMAND_TIMEOUT_SECONDS` deadline.
- Cloud objects, versions, or trash remain after their 90-day eligibility date.

On failure, preserve the PocketBase rows and batch state. Do not manually delete online rows, overwrite a same-name remote object, print payloads, or copy plaintext out of the mode-`0700` work directory. Correct the configuration or provider fault and rerun the same job so it resumes the earliest incomplete batch.

## Monthly isolated restore drill

Once each month, select one committed batch and call the signed `restore-descriptor` route with its `batchId`. Save the exact seven-field response (`batchId`, `objectKey`, `cipherSha256`, `manifestSha256`, `ageRecipientFingerprints`, `rowCount`, and `cursor`) to offline media, record its SHA-256 independently, and only then download the ciphertext and manifest to a newly created isolated directory. The descriptor and its separately recorded hash are the trust anchor; the remote manifest is not. The restore directory must not be inside `/var/lib/hlydwz/mail-archive`, the rclone sync tree, or the repository.

```bash
/usr/bin/python3 /opt/hlydwz/blog/scripts/verify-mail-archive-restore.py \
  --cipher /srv/isolated-restore/example.jsonl.gz.age \
  --manifest /srv/isolated-restore/example.jsonl.gz.age.manifest.json \
  --identity /media/offline-key/age-identity.txt \
  --trusted-descriptor /media/offline-key/example.committed-descriptor.json \
  --trusted-descriptor-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  --archive-work-dir /var/lib/hlydwz/mail-archive \
  --sync-root /srv/mail-archive-sync \
  --repo-root /opt/hlydwz/blog \
  --restore-root /srv/isolated-restore/work
```

The verifier uses `/usr/bin/age-keygen -y` to derive the recipient from the supplied offline identity and requires its fingerprint to appear in the committed, sorted `ageRecipientFingerprints` array. During rotation, either matching offline identity can restore the shared ciphertext; an identity outside that trusted array is rejected before decryption. Record only the batch identifier, verified row count, verification time, operator, and pass/fail result. Never record decrypted rows. The verifier must confirm descriptor hash, manifest hash, cipher/gzip/plaintext hashes, recipient fingerprint membership, gzip integrity, every field's type/enum/bounds, row count, and cursor, then remove all decrypted material on exit. Cleanup failure is a failed drill and must alert. Investigate any failure before the next scheduled deletion or retention purge.

Set `MAIL_ARCHIVE_RESTORE_COMMAND_TIMEOUT_SECONDS=120` in the isolated restore shell if the default must be made explicit. Values outside 1-600 seconds are rejected.
