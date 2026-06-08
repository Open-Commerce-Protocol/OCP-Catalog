ALTER TABLE "commercial_objects" ADD COLUMN "raw_object_hash" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "commercial_objects" ADD COLUMN "descriptor_hash" text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE "provider_sync_controls" (
  "id" text PRIMARY KEY NOT NULL,
  "catalog_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "max_pending_index_jobs" integer,
  "max_running_index_jobs" integer,
  "max_failed_index_jobs" integer,
  "cooldown_until" timestamp with time zone,
  "pause_reason" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_sync_controls_provider_unique"
  ON "provider_sync_controls" ("catalog_id", "provider_id");
--> statement-breakpoint
CREATE INDEX "provider_sync_controls_status_cooldown_idx"
  ON "provider_sync_controls" ("catalog_id", "status", "cooldown_until");
