#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d)"
RESTORE_DB="abada_restore_test_$$"
trap 'rm -rf "$TMP_DIR"' EXIT

COMPOSE=(docker compose --env-file "$ROOT_DIR/release/.env.dev.example" -f "$ROOT_DIR/compose.yaml" -f "$ROOT_DIR/compose.dev.yaml")

"${COMPOSE[@]}" exec -T postgres pg_isready -U abada -d abada_engine >/dev/null
"${COMPOSE[@]}" exec -T postgres pg_dump -U abada -d abada_engine -Fc >"$TMP_DIR/abada.dump"
test -s "$TMP_DIR/abada.dump"

"${COMPOSE[@]}" exec -T postgres dropdb -U abada --if-exists "$RESTORE_DB"
"${COMPOSE[@]}" exec -T postgres createdb -U abada "$RESTORE_DB"
"${COMPOSE[@]}" exec -T postgres pg_restore -U abada -d "$RESTORE_DB" --no-owner --no-privileges <"$TMP_DIR/abada.dump"

SOURCE_MIGRATIONS="$("${COMPOSE[@]}" exec -T postgres psql -U abada -d abada_engine -Atc 'select count(*) from flyway_schema_history where success')"
RESTORED_MIGRATIONS="$("${COMPOSE[@]}" exec -T postgres psql -U abada -d "$RESTORE_DB" -Atc 'select count(*) from flyway_schema_history where success')"
SOURCE_DEFINITIONS="$("${COMPOSE[@]}" exec -T postgres psql -U abada -d abada_engine -Atc 'select count(*) from process_definitions')"
RESTORED_DEFINITIONS="$("${COMPOSE[@]}" exec -T postgres psql -U abada -d "$RESTORE_DB" -Atc 'select count(*) from process_definitions')"

[[ "$SOURCE_MIGRATIONS" == "$RESTORED_MIGRATIONS" ]] || { echo "Error: Flyway history count differs after restore" >&2; exit 1; }
[[ "$SOURCE_DEFINITIONS" == "$RESTORED_DEFINITIONS" ]] || { echo "Error: process definition count differs after restore" >&2; exit 1; }

"${COMPOSE[@]}" exec -T postgres dropdb -U abada "$RESTORE_DB"

# Process files (1.2): RustFS keeps the bytes. Back up its volume after the
# database dump, so every file row in the dump has its object in the archive;
# objects newer than the dump are orphans the engine's sweep removes.
"${COMPOSE[@]}" exec -T rustfs tar -C /data -cf - . >"$TMP_DIR/rustfs.tar"
test -s "$TMP_DIR/rustfs.tar"
mkdir -p "$TMP_DIR/rustfs"
tar -xf "$TMP_DIR/rustfs.tar" -C "$TMP_DIR/rustfs"
BUCKET="$("${COMPOSE[@]}" exec -T abada-engine printenv ABADA_FILES_BUCKET 2>/dev/null || echo abada-files)"
BUCKET="${BUCKET//$'\r'/}"
MISSING=0
while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  [[ -e "$TMP_DIR/rustfs/$BUCKET/$key" ]] || { echo "Missing object for a file row: $key" >&2; MISSING=$((MISSING + 1)); }
done < <("${COMPOSE[@]}" exec -T postgres psql -U abada -d abada_engine -Atc \
  "select object_key from process_files where state <> 'DELETING'")
[[ "$MISSING" -eq 0 ]] || { echo "Error: $MISSING file rows have no object in the RustFS backup" >&2; exit 1; }
FILES="$("${COMPOSE[@]}" exec -T postgres psql -U abada -d abada_engine -Atc "select count(*) from process_files where state <> 'DELETING'")"
echo "RustFS volume archived: every one of $FILES file rows has its object"
echo "Backup/restore verification passed"
