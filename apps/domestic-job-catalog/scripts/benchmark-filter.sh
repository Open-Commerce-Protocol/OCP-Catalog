#!/usr/bin/env bash
set -euo pipefail

payload='{"ocp_version":"1.0","kind":"CatalogQueryRequest","catalog_id":"cat_ocp_domestic_jobs_prod","query_pack":"ocp.job.domestic.filter.v1","query_mode":"filter","filters":{"city":"杭州","recruitment_type":"campus","matching_mode":"computer"},"limit":10,"offset":0,"explain":false}'

for attempt in $(seq 1 12); do
  curl --max-time 35 -sS -o /dev/null \
    -w "${attempt} %{http_code} %{time_total}\n" \
    -H 'content-type: application/json' \
    --data "$payload" \
    http://127.0.0.1:4310/ocp/query
done
