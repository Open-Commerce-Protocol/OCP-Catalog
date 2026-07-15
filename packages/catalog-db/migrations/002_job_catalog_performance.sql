CREATE TABLE IF NOT EXISTS catalog_runtime_stats (
  catalog_id text PRIMARY KEY,
  active_job_count integer NOT NULL,
  counted_at timestamptz NOT NULL
);
--> statement-breakpoint

INSERT INTO catalog_runtime_stats (catalog_id, active_job_count, counted_at)
SELECT :'catalog_id', count(*)::int, now()
FROM catalog_entries
WHERE catalog_id = :'catalog_id'
  AND object_type = 'job'
  AND entry_status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM catalog_runtime_stats WHERE catalog_id = :'catalog_id'
  )
ON CONFLICT (catalog_id) DO NOTHING;
--> statement-breakpoint

DROP TRIGGER IF EXISTS catalog_entries_search_vector_trigger ON catalog_entries;
DROP FUNCTION IF EXISTS catalog_entries_refresh_search_vector();
ALTER TABLE catalog_entries DROP COLUMN IF EXISTS search_vector;
--> statement-breakpoint

DROP INDEX CONCURRENTLY IF EXISTS catalog_entries_search_vector_gin_idx;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION catalog_runtime_stats_adjust()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_active boolean := false;
  new_active boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    old_active := OLD.object_type = 'job' AND OLD.entry_status = 'active';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    new_active := NEW.object_type = 'job' AND NEW.entry_status = 'active';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF old_active THEN
      UPDATE catalog_runtime_stats
      SET active_job_count = GREATEST(active_job_count - 1, 0), counted_at = now()
      WHERE catalog_id = OLD.catalog_id;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF new_active THEN
      INSERT INTO catalog_runtime_stats (catalog_id, active_job_count, counted_at)
      VALUES (NEW.catalog_id, 1, now())
      ON CONFLICT (catalog_id) DO UPDATE
      SET active_job_count = catalog_runtime_stats.active_job_count + 1,
          counted_at = now();
    END IF;
    RETURN NEW;
  END IF;

  IF old_active AND (OLD.catalog_id IS DISTINCT FROM NEW.catalog_id OR NOT new_active) THEN
    UPDATE catalog_runtime_stats
    SET active_job_count = GREATEST(active_job_count - 1, 0), counted_at = now()
    WHERE catalog_id = OLD.catalog_id;
  END IF;
  IF new_active AND (NEW.catalog_id IS DISTINCT FROM OLD.catalog_id OR NOT old_active) THEN
    INSERT INTO catalog_runtime_stats (catalog_id, active_job_count, counted_at)
    VALUES (NEW.catalog_id, 1, now())
    ON CONFLICT (catalog_id) DO UPDATE
    SET active_job_count = catalog_runtime_stats.active_job_count + 1,
        counted_at = now();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS catalog_runtime_stats_trigger ON catalog_entries;
CREATE TRIGGER catalog_runtime_stats_trigger
AFTER INSERT OR UPDATE OF catalog_id, object_type, entry_status OR DELETE
ON catalog_entries
FOR EACH ROW
EXECUTE FUNCTION catalog_runtime_stats_adjust();
--> statement-breakpoint

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

CREATE INDEX CONCURRENTLY IF NOT EXISTS catalog_entries_search_text_trgm_gin_idx
ON catalog_entries USING gin (search_text gin_trgm_ops)
WHERE catalog_id = :'catalog_id' AND object_type = 'job' AND entry_status = 'active';
--> statement-breakpoint

CREATE INDEX CONCURRENTLY IF NOT EXISTS commercial_objects_provider_updated_idx
ON commercial_objects (catalog_id, provider_id, updated_at DESC, id DESC);
