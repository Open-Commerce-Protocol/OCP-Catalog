#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <shard-index: 0-3>" >&2
  exit 64
fi

shard="$1"
if [[ ! "$shard" =~ ^[0-3]$ ]]; then
  echo "Invalid import launcher name: $name" >&2
  exit 64
fi

app_dir="/home/ubuntu/workspace/OCP-Catalog/apps/domestic-job-catalog"

exec /home/ubuntu/.bun/bin/bun "$app_dir/scripts/import-ndjson.ts" \
  --input "$app_dir/import-data/talent-pool-qwen-20260708.domestic-jobs.jsonl" \
  --port "$((4310 + shard))" \
  --shard-index "$shard" \
  --shard-count 4 \
  --batch-size 100 \
  --checkpoint "$app_dir/import-state/talent-pool-qwen-20260708-${shard}.json"
