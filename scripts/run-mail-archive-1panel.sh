#!/usr/bin/env bash
set -euo pipefail
umask 077

test "$(id -u)" -eq 0
test -f /etc/hlydwz/mail-archive.env
test "$(stat -c '%u:%a' /etc/hlydwz/mail-archive.env)" = "0:600"

exec 9>/var/lock/hlydwz-mail-archive.lock
flock -n 9 || exit 0

set -a
. /etc/hlydwz/mail-archive.env
set +a

test "${MAIL_ARCHIVE_WORK_DIR:-}" = "/var/lib/hlydwz/mail-archive"
test "${RCLONE_CONFIG:-}" = "/etc/hlydwz/rclone.conf"
test -f "$RCLONE_CONFIG"
test ! -L "$RCLONE_CONFIG"
test "$(stat -c '%u:%a' "$RCLONE_CONFIG")" = "0:600"

exec /usr/bin/python3 /opt/hlydwz/blog/scripts/mail-archive.py run
