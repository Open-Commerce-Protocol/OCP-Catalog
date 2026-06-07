CREATE TYPE "catalog_embedding_batch_job_status" AS ENUM(
	'created',
	'submitted',
	'validating',
	'in_progress',
	'finalizing',
	'completed',
	'failed',
	'expired',
	'cancelled',
	'ingesting',
	'ingested'
);
--> statement-breakpoint
CREATE TABLE "catalog_embedding_batch_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"status" "catalog_embedding_batch_job_status" DEFAULT 'created' NOT NULL,
	"openai_batch_id" text,
	"input_file_id" text,
	"output_file_id" text,
	"error_file_id" text,
	"embedding_provider" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_dimension" integer NOT NULL,
	"requested_count" integer DEFAULT 0 NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"ingested_count" integer DEFAULT 0 NOT NULL,
	"input_text_chars" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"ingested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "catalog_embedding_batch_jobs_catalog_status_created_idx" ON "catalog_embedding_batch_jobs" USING btree ("catalog_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_embedding_batch_jobs_openai_batch_unique" ON "catalog_embedding_batch_jobs" USING btree ("openai_batch_id");
