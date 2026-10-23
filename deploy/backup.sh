#!/bin/sh
set -eu
umask 077
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="backups/agromind-$stamp.dump"
docker compose --env-file .private/production.env -f deploy/compose.production.yml exec -T db pg_dump -U agromind -d agromind -Fc > "$target.partial"
test -s "$target.partial"
mv "$target.partial" "$target"
printf 'Backup criado: %s\n' "$target"
# No retention deletion: move copies to the operator's protected off-host destination.
