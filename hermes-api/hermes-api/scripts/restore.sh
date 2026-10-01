#!/bin/sh
set -eu

PGHOST="${PGHOST:-postgres}"
PGUSER="${PGUSER:-postgres}"

FILE="${1:-}"
DATABASE="${2:-hermes_api}"

if [ -z "${FILE}" ]; then
    echo "usage: restore.sh <backup.dump> [database]" >&2
    exit 1
fi
if [ ! -f "${FILE}" ]; then
    echo "[restore] file not found: ${FILE}" >&2
    exit 1
fi

echo "[restore] restoring ${FILE} into ${DATABASE}@${PGHOST}"
pg_restore --no-owner --clean --if-exists -h "${PGHOST}" -U "${PGUSER}" -d "${DATABASE}" "${FILE}"
echo "[restore] done"
