CREATE TYPE "public"."catalog_reconcile_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "catalog_search_reconcile_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"reconcile_kind" text NOT NULL,
	"status" "catalog_reconcile_status" DEFAULT 'running' NOT NULL,
	"cursor_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scanned_entry_count" integer DEFAULT 0 NOT NULL,
	"upserted_document_count" integer DEFAULT 0 NOT NULL,
	"enqueued_embedding_jobs" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_search_reconcile_checkpoints_catalog_kind_unique" ON "catalog_search_reconcile_checkpoints" USING btree ("catalog_id","reconcile_kind");--> statement-breakpoint
CREATE INDEX "catalog_search_reconcile_checkpoints_status_updated_idx" ON "catalog_search_reconcile_checkpoints" USING btree ("catalog_id","status","updated_at");