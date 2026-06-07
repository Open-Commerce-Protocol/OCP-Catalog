ALTER TYPE "public"."object_sync_batch_status" RENAME TO "object_sync_chunk_status";--> statement-breakpoint
ALTER TABLE "object_sync_batches" RENAME TO "object_sync_chunks";--> statement-breakpoint
ALTER TABLE "object_sync_item_results" RENAME COLUMN "sync_batch_id" TO "sync_chunk_id";--> statement-breakpoint
ALTER INDEX "object_sync_batches_provider_batch_unique" RENAME TO "object_sync_chunks_provider_batch_unique";--> statement-breakpoint
ALTER INDEX "object_sync_batches_provider_created_idx" RENAME TO "object_sync_chunks_provider_created_idx";--> statement-breakpoint
ALTER INDEX "object_sync_batches_run_chunk_unique" RENAME TO "object_sync_chunks_run_chunk_unique";--> statement-breakpoint
ALTER INDEX "object_sync_batches_run_idx" RENAME TO "object_sync_chunks_run_idx";--> statement-breakpoint
ALTER INDEX "object_sync_item_results_batch_idx" RENAME TO "object_sync_item_results_chunk_idx";--> statement-breakpoint
ALTER INDEX "object_sync_item_results_batch_object_unique" RENAME TO "object_sync_item_results_chunk_object_unique";--> statement-breakpoint
ALTER TABLE "object_sync_chunks" RENAME CONSTRAINT "object_sync_batches_sync_run_row_id_object_sync_runs_id_fk" TO "object_sync_chunks_sync_run_row_id_object_sync_runs_id_fk";--> statement-breakpoint
ALTER TABLE "object_sync_item_results" RENAME CONSTRAINT "object_sync_item_results_sync_batch_id_object_sync_batches_id_fk" TO "object_sync_item_results_sync_chunk_id_object_sync_chunks_id_fk";
