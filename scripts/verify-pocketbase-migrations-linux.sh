#!/usr/bin/env bash
# Verify PocketBase migrations against the Linux production image without touching production data.
# Usage: bash scripts/verify-pocketbase-migrations-linux.sh [repo-root]

set -euo pipefail

REPO_ROOT="${1:-$(pwd)}"
MIGRATIONS_DIR="$REPO_ROOT/pb_migrations"
IMAGE="${POCKETBASE_IMAGE:-ghcr.io/muchobien/pocketbase:0.22.21}"
VERIFY_ROOT="$(mktemp -d /tmp/blog-pb-migration-verify.XXXXXX)"
DATA_DIR="$VERIFY_ROOT/pb_data"
EMPTY_MIGRATIONS_DIR="$VERIFY_ROOT/empty_migrations"
BOOTSTRAP_CONTAINER_NAME="blog-pb-bootstrap-$$"
VERIFY_CONTAINER_NAME="blog-pb-migration-verify-$$"

cleanup() {
  docker rm -f "$BOOTSTRAP_CONTAINER_NAME" "$VERIFY_CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "$VERIFY_ROOT"
}
trap cleanup EXIT

fail() {
  echo "FAIL $*" >&2
  for name in "$BOOTSTRAP_CONTAINER_NAME" "$VERIFY_CONTAINER_NAME"; do
    if docker ps -a --format '{{.Names}}' | grep -Fxq "$name"; then
      echo "--- Docker logs: $name ---" >&2
      docker logs "$name" >&2 || true
    fi
  done
  exit 1
}

wait_running() {
  local name="$1"
  local seconds="${2:-15}"
  for _ in $(seq 1 "$seconds"); do
    if docker ps --format '{{.Names}}' | grep -Fxq "$name"; then
      return 0
    fi
    if docker ps -a --format '{{.Names}}' | grep -Fxq "$name"; then
      return 1
    fi
    sleep 1
  done
  return 1
}

command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v python3 >/dev/null 2>&1 || fail "python3 is required for SQLite assertions"
[ -d "$MIGRATIONS_DIR" ] || fail "missing migrations dir: $MIGRATIONS_DIR"

mkdir -p "$DATA_DIR" "$EMPTY_MIGRATIONS_DIR"

echo "Using image: $IMAGE"
echo "Using migrations: $MIGRATIONS_DIR"
echo "Using temp data: $DATA_DIR"

echo "Bootstrapping PocketBase system tables with an empty migrations dir..."
docker run \
  --name "$BOOTSTRAP_CONTAINER_NAME" \
  -d \
  -v "$DATA_DIR:/pb_data" \
  -v "$EMPTY_MIGRATIONS_DIR:/pb_migrations:ro" \
  "$IMAGE" \
  serve --dir=/pb_data --migrationsDir=/pb_migrations --hooksDir=/pb_hooks --http=0.0.0.0:8090 >/dev/null

wait_running "$BOOTSTRAP_CONTAINER_NAME" 15 || fail "PocketBase bootstrap container exited before creating system tables"
sleep 2
docker rm -f "$BOOTSTRAP_CONTAINER_NAME" >/dev/null

[ -f "$DATA_DIR/data.db" ] || fail "bootstrap did not create data.db"

echo "Applying project migrations to the initialized temp database..."
docker run \
  --name "$VERIFY_CONTAINER_NAME" \
  -d \
  -v "$DATA_DIR:/pb_data" \
  -v "$MIGRATIONS_DIR:/pb_migrations:ro" \
  "$IMAGE" \
  serve --dir=/pb_data --migrationsDir=/pb_migrations --hooksDir=/pb_hooks --http=0.0.0.0:8090 >/dev/null

wait_running "$VERIFY_CONTAINER_NAME" 30 || fail "PocketBase container exited while applying migrations"
sleep 2
docker rm -f "$VERIFY_CONTAINER_NAME" >/dev/null

DB_FILE="$DATA_DIR/data.db"
[ -f "$DB_FILE" ] || fail "PocketBase data.db was not created"

python3 - "$DB_FILE" <<'PY'
import json
import sqlite3
import sys

(db_file,) = sys.argv[1:]
conn = sqlite3.connect(db_file)
conn.row_factory = sqlite3.Row
rows = conn.execute('select name, type, listRule, viewRule, createRule, updateRule, deleteRule, options from _collections').fetchall()
collections = {row['name']: dict(row) for row in rows}


def require(condition, message):
    if not condition:
        raise SystemExit(f'FAIL {message}')

for name in ['comments', 'public_comments', 'settings', 'post_tags']:
    require(name in collections, f'missing collection {name}')

comments = collections['comments']
public_comments = collections['public_comments']
settings = collections['settings']
post_tags = collections['post_tags']

require(public_comments['type'] == 'view', 'public_comments must be a view collection')
options = json.loads(public_comments['options'] or '{}')
query = options.get('query') or ''
require('author_email' not in query.lower(), 'public_comments query exposes author_email')
require('ip_address' not in query.lower(), 'public_comments query exposes ip_address')
require('SELECT id, post_id, author_name, content, parent_id, status, created, updated' in query, 'public_comments query is not the expected safe projection')

require('status = "approved"' not in (comments['listRule'] or ''), 'comments listRule still allows anonymous approved reads')
require('status = "approved"' not in (comments['viewRule'] or ''), 'comments viewRule still allows anonymous approved reads')
require(comments['createRule'] == 'post_id.status = "published"', 'comments createRule mismatch')

require('debug_protection_enabled' in (settings['listRule'] or ''), 'settings public allowlist missing debug_protection_enabled')
require(settings['updateRule'] == '@request.auth.role = "super_admin"', 'settings updateRule must be super_admin only')
require('post_id.author.id = @request.auth.id' in (post_tags['updateRule'] or ''), 'post_tags author ownership guard missing')

print('OK PocketBase migrations verified against initialized data.db')
print(json.dumps({
    'public_comments': {'type': public_comments['type'], 'query': query},
    'comments': {'listRule': comments['listRule'], 'viewRule': comments['viewRule'], 'createRule': comments['createRule']},
    'settings': {'listRule': settings['listRule'], 'updateRule': settings['updateRule']},
    'post_tags': {'updateRule': post_tags['updateRule']},
}, ensure_ascii=False, indent=2))
PY