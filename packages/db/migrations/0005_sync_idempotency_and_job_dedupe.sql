ALTER TABLE "object_sync_batches" ADD COLUMN "request_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "object_sync_batches" ALTER COLUMN "request_hash" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "object_sync_item_results" ADD COLUMN "item_ordinal" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "object_sync_item_results_batch_object_unique" ON "object_sync_item_results" USING btree ("sync_batch_id","object_id");--> statement-breakpoint
ALTER TABLE "catalog_search_index_jobs" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_search_index_jobs_catalog_dedupe_unique" ON "catalog_search_index_jobs" USING btree ("catalog_id","dedupe_key");
