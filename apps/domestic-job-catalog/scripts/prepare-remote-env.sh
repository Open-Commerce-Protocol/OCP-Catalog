#!/usr/bin/env bash
set -euo pipefail

source_env="${1:-}"
if [[ -z "$source_env" || ! -f "$source_env" ]]; then
  echo "usage: $0 /path/to/domestic-job-catalog.env" >&2
  exit 2
fi

required=(
  CATALOG_ID CATALOG_PUBLIC_BASE_URL CORS_ALLOWED_ORIGINS INGEST_API_KEY DATABASE_URL
  OPENSEARCH_NODE OPENSEARCH_INDEX EMBEDDING_BASE_URL EMBEDDING_API_KEY EMBEDDING_MODEL EMBEDDING_DIMENSION
)
for key in "${required[@]}"; do
  if ! grep -qE "^${key}=.+" "$source_env"; then
    echo "missing required Domestic Catalog setting: ${key}" >&2
    exit 1
  fi
done
if ! grep -qE '^CATALOG_ID=cat_ocp_domestic_jobs_prod$' "$source_env"; then
  echo "CATALOG_ID must be cat_ocp_domestic_jobs_prod" >&2
  exit 1
fi
if ! grep -qE '^CORS_ALLOWED_ORIGINS=([^,]*,)*https://ocp\.deeplumen\.io(,|$)' "$source_env"; then
  echo "CORS_ALLOWED_ORIGINS must include https://ocp.deeplumen.io" >&2
  exit 1
fi

sudo install -m 0640 -o root -g ubuntu "$source_env" /etc/ocp-domestic-job-catalog.env
echo 'installed /etc/ocp-domestic-job-catalog.env'
