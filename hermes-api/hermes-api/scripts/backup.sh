#!/bin/sh
set -eu

PGHOST="${PGHOST:-postgres}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-hermes_api}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP="${KEEP:-14}"

TS="$(date -u +%Y%m%d_%H%M%S)"
FILE="${BACKUP_DIR}/hermes_${TS}.dump"

mkdir -p "${BACKUP_DIR}"
echo "[backup] dumping ${PGDATABASE}@${PGHOST} -> ${FILE}"
pg_dump -h "${PGHOST}" -U "${PGUSER}" -Fc -f "${FILE}" "${PGDATABASE}"
echo "[backup] ok: $(du -h "${FILE}" | cut -f1)"

COUNT="$(ls -1 "${BACKUP_DIR}"/hermes_*.dump 2>/dev/null | wc -l)"
if [ "${COUNT}" -gt "${KEEP}" ]; then
    ls -1t "${BACKUP_DIR}"/hermes_*.dump | tail -n +$((KEEP + 1)) | xargs -r rm -f
    echo "[backup] pruned old backups (keeping ${KEEP})"
fi
