CREATE TYPE "public"."catalog_outbox_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."object_sync_run_mode" AS ENUM('batch', 'stream');--> statement-breakpoint
CREATE TYPE "public"."object_sync_run_status" AS ENUM('running', 'accepted', 'partial', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "catalog_outbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"provider_id" text,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" "catalog_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 10 NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"registration_version" integer NOT NULL,
	"sync_run_id" text NOT NULL,
	"run_mode" "object_sync_run_mode" NOT NULL,
	"status" "object_sync_run_status" DEFAULT 'running' NOT NULL,
	"stream_batch_id" text,
	"batch_count" integer DEFAULT 0 NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"last_batch_id" text,
	"last_chunk_ordinal" integer,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "object_sync_batches" ADD COLUMN "sync_run_row_id" text;--> statement-breakpoint
ALTER TABLE "object_sync_batches" ADD COLUMN "chunk_ordinal" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_outbox_events_catalog_dedupe_unique" ON "catalog_outbox_events" USING btree ("catalog_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "catalog_outbox_events_catalog_status_scheduled_idx" ON "catalog_outbox_events" USING btree ("catalog_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "catalog_outbox_events_catalog_aggregate_idx" ON "catalog_outbox_events" USING btree ("catalog_id","aggregate_type","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "object_sync_runs_provider_run_unique" ON "object_sync_runs" USING btree ("catalog_id","provider_id","sync_run_id");--> statement-breakpoint
CREATE INDEX "object_sync_runs_provider_created_idx" ON "object_sync_runs" USING btree ("catalog_id","provider_id","created_at");--> statement-breakpoint
CREATE INDEX "object_sync_runs_catalog_status_updated_idx" ON "object_sync_runs" USING btree ("catalog_id","status","updated_at");--> statement-breakpoint
ALTER TABLE "object_sync_batches" ADD CONSTRAINT "object_sync_batches_sync_run_row_id_object_sync_runs_id_fk" FOREIGN KEY ("sync_run_row_id") REFERENCES "public"."object_sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "object_sync_batches_run_chunk_unique" ON "object_sync_batches" USING btree ("sync_run_row_id","chunk_ordinal");--> statement-breakpoint
CREATE INDEX "object_sync_batches_run_idx" ON "object_sync_batches" USING btree ("sync_run_row_id");