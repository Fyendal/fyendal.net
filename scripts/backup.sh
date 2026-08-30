#!/bin/sh
# Daily Postgres backup loop (runs inside the `backup` compose service).
# - pg_dump custom format, gzipped, into /backups (named volume `pgbackups`)
# - rotates to KEEP_DAYS days (default 14)
# - optional GCS upload when GCS_BUCKET is set *and* gsutil is available
#   (the stock postgres:16-alpine image has no gsutil)
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
INTERVAL="${BACKUP_INTERVAL:-86400}" # seconds between dumps

dump_once() {
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  file="$BACKUP_DIR/fyendal-$ts.dump.gz"
  tmp="$BACKUP_DIR/fyendal-$ts.dump.tmp"
  echo "[backup] $(date -u -Iseconds) dumping $PGDATABASE → $file"
  # no pipe: a failed pg_dump must not produce a good-looking backup
  if ! pg_dump --format=custom > "$tmp"; then
    echo "[backup] dump FAILED" >&2
    rm -f "$tmp"
    return 1
  fi
  if ! gzip -6 "$tmp"; then
    echo "[backup] gzip FAILED" >&2
    rm -f "$tmp" "$tmp.gz"
    return 1
  fi
  mv "$tmp.gz" "$file"
  echo "[backup] wrote $(du -h "$file" | cut -f1) → $file"

  # rotation: keep the last KEEP_DAYS days
  find "$BACKUP_DIR" -name 'fyendal-*.dump.gz' -mtime "+$KEEP_DAYS" -delete

  if [ -n "${GCS_BUCKET:-}" ]; then
    if command -v gsutil >/dev/null 2>&1; then
      echo "[backup] uploading to gs://$GCS_BUCKET/"
      gsutil -q cp "$file" "gs://$GCS_BUCKET/" || echo "[backup] GCS upload failed" >&2
    else
      echo "[backup] GCS_BUCKET is set but gsutil is not installed in this image — skipping upload"
    fi
  fi
}

echo "[backup] starting: every ${INTERVAL}s, keep ${KEEP_DAYS} days, dir $BACKUP_DIR"
while true; do
  dump_once || true # a failed dump must not kill the loop
  sleep "$INTERVAL"
done
