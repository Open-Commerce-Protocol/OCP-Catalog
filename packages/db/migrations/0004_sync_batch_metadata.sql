ALTER TABLE "object_sync_batches" ADD COLUMN "request_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "object_sync_batches" ADD COLUMN "result_summary" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "object_sync_batches" DROP COLUMN "request_payload";--> statement-breakpoint
ALTER TABLE "object_sync_batches" DROP COLUMN "result_payload";
