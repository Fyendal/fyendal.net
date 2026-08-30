#!/bin/sh
# Restore a gzipped custom-format pg_dump into the compose Postgres.
# Run on the VM from the repo root:  ./scripts/restore.sh <backup.dump.gz>
#
# Getting a backup file to the VM:
#   - copy it from the Compose pgbackups volume, or
#   - from GCS:  gsutil cp gs://<bucket>/<name>.dump.gz .
set -eu

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "usage: $0 <backup.dump.gz>" >&2
  exit 1
fi

# load POSTGRES_USER / POSTGRES_DB from .env when present
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
PGUSER_NAME="${POSTGRES_USER:-fyendal}"
PGDB="${POSTGRES_DB:-fyendal}"

echo "==> stopping app (db stays up)"
docker compose stop app

echo "==> restoring $FILE into database '$PGDB' (this DROPS and recreates its tables)"
gunzip -c "$FILE" | docker compose exec -T db \
  pg_restore -U "$PGUSER_NAME" -d "$PGDB" --clean --if-exists --single-transaction

echo "==> starting app"
docker compose start app

echo "==> restore complete — verify with: docker compose exec app node -e \"fetch('http://127.0.0.1:8080/api/health').then(r=>console.log(r.status))\""
