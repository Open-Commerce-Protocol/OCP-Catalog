#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <batch-id-prefix>" >&2
  exit 2
fi

DATABASE_URL="$(grep '^DATABASE_URL=' /home/ubuntu/workspace/OCP-Catalog/.env.jobs | sed 's/^DATABASE_URL=//')"
if [[ -z "$DATABASE_URL" ]]; then
  echo "DATABASE_URL not found in .env.jobs" >&2
  exit 1
fi

prefix_sql="${1//\'/\'\'}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -At <<SQL
select 'chunk_columns=' || string_agg(column_name, ',' order by ordinal_position)
from information_schema.columns
where table_schema = 'public'
  and table_name = 'object_sync_chunks';

select 'latest_batch=' || coalesce(max(batch_id), '')
from object_sync_chunks
where batch_id like '$prefix_sql:%';

select 'chunk_count=' || count(*)
from object_sync_chunks
where batch_id like '$prefix_sql:%';

select 'item_status=' || i.status || ':' || count(*)
from object_sync_item_results i
join object_sync_chunks c on c.id = i.sync_chunk_id
where c.batch_id like '$prefix_sql:%'
group by i.status
order by i.status;

select 'latest_rejected=' || coalesce(max(c.batch_id), '')
from object_sync_item_results i
join object_sync_chunks c on c.id = i.sync_chunk_id
where c.batch_id like '$prefix_sql:%'
  and i.status <> 'accepted';
SQL
