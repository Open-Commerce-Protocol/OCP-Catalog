CREATE TYPE "public"."catalog_outbox_status" AS ENUM('pending', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."entry_status" AS ENUM('active', 'inactive', 'rejected', 'pending_verification');--> statement-breakpoint
CREATE TYPE "public"."object_sync_chunk_status" AS ENUM('accepted', 'partial', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."object_sync_item_status" AS ENUM('accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."object_sync_run_mode" AS ENUM('batch', 'stream');--> statement-breakpoint
CREATE TYPE "public"."object_sync_run_status" AS ENUM('running', 'accepted', 'partial', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."provider_contract_state_status" AS ENUM('active', 'inactive', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('accepted_full', 'accepted_limited', 'rejected', 'pending_verification');--> statement-breakpoint
CREATE TYPE "public"."catalog_embedding_batch_item_status" AS ENUM('submitted', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."catalog_embedding_batch_job_status" AS ENUM('created', 'submitted', 'validating', 'in_progress', 'finalizing', 'completed', 'failed', 'expired', 'cancelled', 'ingesting', 'ingested');--> statement-breakpoint
CREATE TYPE "public"."catalog_embedding_work_item_status" AS ENUM('pending', 'submitted', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."catalog_reconcile_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."catalog_search_document_status" AS ENUM('pending', 'active', 'inactive', 'stale', 'failed');--> statement-breakpoint
CREATE TYPE "public"."catalog_search_index_job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."catalog_search_index_job_type" AS ENUM('upsert_document', 'rebuild_document', 'delete_document', 'refresh_embedding', 'rebuild_all_for_provider');--> statement-breakpoint
CREATE TABLE "catalog_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"commercial_object_id" text NOT NULL,
	"object_type" text NOT NULL,
	"provider_id" text DEFAULT '' NOT NULL,
	"object_id" text DEFAULT '' NOT NULL,
	"entry_status" "entry_status" DEFAULT 'pending_verification' NOT NULL,
	"contract_match_status" text DEFAULT 'unchecked' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"summary" text,
	"brand" text,
	"category" text,
	"currency" text,
	"availability_status" text,
	"search_text" text DEFAULT '' NOT NULL,
	"search_projection" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"explain_projection" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "catalog_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"catalog_name" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commercial_objects" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"object_id" text NOT NULL,
	"object_type" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"status" text DEFAULT 'active' NOT NULL,
	"source_url" text,
	"raw_object" jsonb NOT NULL,
	"raw_object_hash" text DEFAULT '' NOT NULL,
	"descriptor_hash" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "descriptor_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"commercial_object_id" text NOT NULL,
	"pack_id" text NOT NULL,
	"schema_uri" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"contract_id" text NOT NULL,
	"object_type" text NOT NULL,
	"contract" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "object_sync_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"registration_version" integer NOT NULL,
	"sync_run_row_id" text,
	"chunk_ordinal" integer,
	"batch_id" text NOT NULL,
	"status" "object_sync_chunk_status" DEFAULT 'rejected' NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"request_hash" text NOT NULL,
	"request_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "object_sync_item_results" (
	"id" text PRIMARY KEY NOT NULL,
	"sync_chunk_id" text NOT NULL,
	"item_ordinal" integer DEFAULT 0 NOT NULL,
	"object_id" text,
	"status" "object_sync_item_status" NOT NULL,
	"commercial_object_id" text,
	"catalog_entry_id" text,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "provider_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_contract_states" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"active_registration_id" text NOT NULL,
	"active_registration_version" integer NOT NULL,
	"status" "provider_contract_state_status" DEFAULT 'active' NOT NULL,
	"declared_object_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"declared_packs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guaranteed_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"registration_version" integer NOT NULL,
	"status" "registration_status" DEFAULT 'pending_verification' NOT NULL,
	"registration" jsonb NOT NULL,
	"result" jsonb,
	"source_ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
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
CREATE TABLE "query_audit_records" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"query_kind" text NOT NULL,
	"request_payload" jsonb NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"requester_key_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resolvable_references" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"commercial_object_id" text NOT NULL,
	"catalog_entry_id" text,
	"reference_type" text DEFAULT 'commercial_object' NOT NULL,
	"resolved_title" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_embedding_batch_items" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"embedding_batch_job_id" text NOT NULL,
	"embedding_work_item_id" text NOT NULL,
	"catalog_search_document_id" text NOT NULL,
	"input_text" text NOT NULL,
	"input_text_hash" text NOT NULL,
	"input_text_chars" integer NOT NULL,
	"status" "catalog_embedding_batch_item_status" DEFAULT 'submitted' NOT NULL,
	"output_line_number" integer,
	"error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"ingested_output_line_count" integer DEFAULT 0 NOT NULL,
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
CREATE TABLE "catalog_embedding_work_items" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"provider_id" text,
	"catalog_search_document_id" text NOT NULL,
	"embedding_provider" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_dimension" integer NOT NULL,
	"status" "catalog_embedding_work_item_status" DEFAULT 'pending' NOT NULL,
	"reason" text NOT NULL,
	"embedding_batch_job_id" text,
	"source_search_index_job_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"error" text,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_deadline_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_search_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"catalog_entry_id" text NOT NULL,
	"commercial_object_id" text NOT NULL,
	"provider_id" text DEFAULT '' NOT NULL,
	"object_id" text DEFAULT '' NOT NULL,
	"object_type" text NOT NULL,
	"document_status" "catalog_search_document_status" DEFAULT 'pending' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"normalized_title" text DEFAULT '' NOT NULL,
	"summary" text,
	"brand" text,
	"normalized_brand" text DEFAULT '' NOT NULL,
	"category" text,
	"normalized_category" text DEFAULT '' NOT NULL,
	"sku" text,
	"normalized_sku" text DEFAULT '' NOT NULL,
	"currency" text,
	"availability_status" text,
	"amount" double precision,
	"list_amount" double precision,
	"has_image" boolean DEFAULT false NOT NULL,
	"has_product_url" boolean DEFAULT false NOT NULL,
	"discount_present" boolean DEFAULT false NOT NULL,
	"quality_tier" text,
	"availability_rank" integer DEFAULT 0 NOT NULL,
	"quality_rank" integer DEFAULT 0 NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"search_vector" "tsvector",
	"facet_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ranking_features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visible_attributes_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"explain_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_updated_at" timestamp with time zone,
	"indexed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_search_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"catalog_search_document_id" text NOT NULL,
	"embedding_provider" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_dimension" integer NOT NULL,
	"embedding_text" text NOT NULL,
	"embedding_text_hash" text NOT NULL,
	"embedding_vector" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding_vector_pg" vector,
	"status" text DEFAULT 'ready' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_search_index_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"provider_id" text,
	"catalog_entry_id" text,
	"commercial_object_id" text,
	"search_document_id" text,
	"dedupe_key" text,
	"job_type" "catalog_search_index_job_type" NOT NULL,
	"status" "catalog_search_index_job_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
ALTER TABLE "catalog_entries" ADD CONSTRAINT "catalog_entries_commercial_object_id_commercial_objects_id_fk" FOREIGN KEY ("commercial_object_id") REFERENCES "public"."commercial_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "descriptor_instances" ADD CONSTRAINT "descriptor_instances_commercial_object_id_commercial_objects_id_fk" FOREIGN KEY ("commercial_object_id") REFERENCES "public"."commercial_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sync_chunks" ADD CONSTRAINT "object_sync_chunks_sync_run_row_id_object_sync_runs_id_fk" FOREIGN KEY ("sync_run_row_id") REFERENCES "public"."object_sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sync_item_results" ADD CONSTRAINT "object_sync_item_results_sync_chunk_id_object_sync_chunks_id_fk" FOREIGN KEY ("sync_chunk_id") REFERENCES "public"."object_sync_chunks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sync_item_results" ADD CONSTRAINT "object_sync_item_results_commercial_object_id_commercial_objects_id_fk" FOREIGN KEY ("commercial_object_id") REFERENCES "public"."commercial_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sync_item_results" ADD CONSTRAINT "object_sync_item_results_catalog_entry_id_catalog_entries_id_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."catalog_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_contract_states" ADD CONSTRAINT "provider_contract_states_active_registration_id_provider_registrations_id_fk" FOREIGN KEY ("active_registration_id") REFERENCES "public"."provider_registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolvable_references" ADD CONSTRAINT "resolvable_references_commercial_object_id_commercial_objects_id_fk" FOREIGN KEY ("commercial_object_id") REFERENCES "public"."commercial_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolvable_references" ADD CONSTRAINT "resolvable_references_catalog_entry_id_catalog_entries_id_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."catalog_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_embedding_batch_items" ADD CONSTRAINT "catalog_embedding_batch_items_embedding_batch_job_id_catalog_embedding_batch_jobs_id_fk" FOREIGN KEY ("embedding_batch_job_id") REFERENCES "public"."catalog_embedding_batch_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_embedding_batch_items" ADD CONSTRAINT "catalog_embedding_batch_items_embedding_work_item_id_catalog_embedding_work_items_id_fk" FOREIGN KEY ("embedding_work_item_id") REFERENCES "public"."catalog_embedding_work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_search_documents" ADD CONSTRAINT "catalog_search_documents_catalog_entry_id_catalog_entries_id_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."catalog_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_search_documents" ADD CONSTRAINT "catalog_search_documents_commercial_object_id_commercial_objects_id_fk" FOREIGN KEY ("commercial_object_id") REFERENCES "public"."commercial_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_search_embeddings" ADD CONSTRAINT "catalog_search_embeddings_catalog_search_document_id_catalog_search_documents_id_fk" FOREIGN KEY ("catalog_search_document_id") REFERENCES "public"."catalog_search_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_search_index_jobs" ADD CONSTRAINT "catalog_search_index_jobs_catalog_entry_id_catalog_entries_id_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."catalog_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_search_index_jobs" ADD CONSTRAINT "catalog_search_index_jobs_commercial_object_id_commercial_objects_id_fk" FOREIGN KEY ("commercial_object_id") REFERENCES "public"."commercial_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_entries_catalog_type_status_idx" ON "catalog_entries" USING btree ("catalog_id","object_type","entry_status");--> statement-breakpoint
CREATE INDEX "catalog_entries_catalog_provider_status_idx" ON "catalog_entries" USING btree ("catalog_id","provider_id","entry_status");--> statement-breakpoint
CREATE INDEX "catalog_entries_catalog_category_status_idx" ON "catalog_entries" USING btree ("catalog_id","category","entry_status");--> statement-breakpoint
CREATE INDEX "catalog_entries_catalog_brand_status_idx" ON "catalog_entries" USING btree ("catalog_id","brand","entry_status");--> statement-breakpoint
CREATE INDEX "catalog_entries_catalog_availability_status_idx" ON "catalog_entries" USING btree ("catalog_id","availability_status","entry_status");--> statement-breakpoint
CREATE INDEX "catalog_entries_reconcile_page_idx" ON "catalog_entries" USING btree ("catalog_id","entry_status","updated_at","id");--> statement-breakpoint
CREATE INDEX "catalog_entries_admin_updated_idx" ON "catalog_entries" USING btree ("catalog_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "catalog_entries_provider_admin_updated_idx" ON "catalog_entries" USING btree ("catalog_id","provider_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_entries_commercial_object_unique" ON "catalog_entries" USING btree ("commercial_object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_outbox_events_catalog_dedupe_unique" ON "catalog_outbox_events" USING btree ("catalog_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "catalog_outbox_events_catalog_status_scheduled_idx" ON "catalog_outbox_events" USING btree ("catalog_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "catalog_outbox_events_catalog_status_idx" ON "catalog_outbox_events" USING btree ("catalog_id","status");--> statement-breakpoint
CREATE INDEX "catalog_outbox_events_pending_claim_idx" ON "catalog_outbox_events" USING btree ("catalog_id","scheduled_at","created_at","id") WHERE "catalog_outbox_events"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "catalog_outbox_events_stale_running_claim_idx" ON "catalog_outbox_events" USING btree ("catalog_id","locked_at","scheduled_at","created_at","id") WHERE "catalog_outbox_events"."status" = 'running' and "catalog_outbox_events"."locked_at" is not null;--> statement-breakpoint
CREATE INDEX "catalog_outbox_events_catalog_aggregate_idx" ON "catalog_outbox_events" USING btree ("catalog_id","aggregate_type","aggregate_id");--> statement-breakpoint
CREATE INDEX "catalog_outbox_events_queue_trend_created_idx" ON "catalog_outbox_events" USING btree ("catalog_id","created_at","event_type");--> statement-breakpoint
CREATE INDEX "catalog_outbox_events_queue_trend_finished_idx" ON "catalog_outbox_events" USING btree ("catalog_id","finished_at","status","event_type") WHERE "catalog_outbox_events"."finished_at" is not null and "catalog_outbox_events"."status" in ('completed', 'failed');--> statement-breakpoint
CREATE INDEX "catalog_outbox_events_completed_cleanup_idx" ON "catalog_outbox_events" USING btree ("catalog_id","finished_at","id") WHERE "catalog_outbox_events"."status" = 'completed' and "catalog_outbox_events"."finished_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_profiles_catalog_id_unique" ON "catalog_profiles" USING btree ("catalog_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_objects_provider_object_unique" ON "commercial_objects" USING btree ("catalog_id","provider_id","object_id");--> statement-breakpoint
CREATE INDEX "commercial_objects_catalog_type_idx" ON "commercial_objects" USING btree ("catalog_id","object_type");--> statement-breakpoint
CREATE INDEX "descriptor_instances_object_pack_idx" ON "descriptor_instances" USING btree ("commercial_object_id","pack_id");--> statement-breakpoint
CREATE UNIQUE INDEX "object_contracts_catalog_contract_unique" ON "object_contracts" USING btree ("catalog_id","contract_id");--> statement-breakpoint
CREATE INDEX "object_contracts_catalog_object_type_idx" ON "object_contracts" USING btree ("catalog_id","object_type");--> statement-breakpoint
CREATE UNIQUE INDEX "object_sync_chunks_provider_batch_unique" ON "object_sync_chunks" USING btree ("catalog_id","provider_id","batch_id");--> statement-breakpoint
CREATE INDEX "object_sync_chunks_provider_created_idx" ON "object_sync_chunks" USING btree ("catalog_id","provider_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "object_sync_chunks_run_chunk_unique" ON "object_sync_chunks" USING btree ("sync_run_row_id","chunk_ordinal");--> statement-breakpoint
CREATE INDEX "object_sync_chunks_run_idx" ON "object_sync_chunks" USING btree ("sync_run_row_id");--> statement-breakpoint
CREATE INDEX "object_sync_item_results_chunk_idx" ON "object_sync_item_results" USING btree ("sync_chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "object_sync_item_results_chunk_object_unique" ON "object_sync_item_results" USING btree ("sync_chunk_id","object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "object_sync_runs_provider_run_unique" ON "object_sync_runs" USING btree ("catalog_id","provider_id","sync_run_id");--> statement-breakpoint
CREATE INDEX "object_sync_runs_provider_created_idx" ON "object_sync_runs" USING btree ("catalog_id","provider_id","created_at");--> statement-breakpoint
CREATE INDEX "object_sync_runs_catalog_status_updated_idx" ON "object_sync_runs" USING btree ("catalog_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_api_keys_provider_unique" ON "provider_api_keys" USING btree ("catalog_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_api_keys_key_hash_unique" ON "provider_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "provider_api_keys_provider_status_idx" ON "provider_api_keys" USING btree ("catalog_id","provider_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_contract_states_provider_unique" ON "provider_contract_states" USING btree ("catalog_id","provider_id");--> statement-breakpoint
CREATE INDEX "provider_contract_states_active_registration_idx" ON "provider_contract_states" USING btree ("active_registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_registrations_provider_version_unique" ON "provider_registrations" USING btree ("catalog_id","provider_id","registration_version");--> statement-breakpoint
CREATE INDEX "provider_registrations_provider_idx" ON "provider_registrations" USING btree ("catalog_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_sync_controls_provider_unique" ON "provider_sync_controls" USING btree ("catalog_id","provider_id");--> statement-breakpoint
CREATE INDEX "provider_sync_controls_status_cooldown_idx" ON "provider_sync_controls" USING btree ("catalog_id","status","cooldown_until");--> statement-breakpoint
CREATE INDEX "query_audit_records_catalog_created_idx" ON "query_audit_records" USING btree ("catalog_id","created_at");--> statement-breakpoint
CREATE INDEX "catalog_embedding_batch_items_batch_status_idx" ON "catalog_embedding_batch_items" USING btree ("catalog_id","embedding_batch_job_id","status","id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_embedding_batch_items_batch_document_unique" ON "catalog_embedding_batch_items" USING btree ("embedding_batch_job_id","catalog_search_document_id");--> statement-breakpoint
CREATE INDEX "catalog_embedding_batch_jobs_catalog_status_created_idx" ON "catalog_embedding_batch_jobs" USING btree ("catalog_id","status","created_at");--> statement-breakpoint
CREATE INDEX "catalog_embedding_batch_jobs_pollable_idx" ON "catalog_embedding_batch_jobs" USING btree ("catalog_id","created_at","id") WHERE "catalog_embedding_batch_jobs"."status" in ('submitted','validating','in_progress','finalizing');--> statement-breakpoint
CREATE INDEX "catalog_embedding_batch_jobs_completed_ingest_idx" ON "catalog_embedding_batch_jobs" USING btree ("catalog_id","created_at","id") WHERE "catalog_embedding_batch_jobs"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "catalog_embedding_batch_jobs_stale_ingesting_idx" ON "catalog_embedding_batch_jobs" USING btree ("catalog_id","updated_at","created_at","id") WHERE "catalog_embedding_batch_jobs"."status" = 'ingesting';--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_embedding_batch_jobs_openai_batch_unique" ON "catalog_embedding_batch_jobs" USING btree ("openai_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_embedding_work_items_document_model_unique" ON "catalog_embedding_work_items" USING btree ("catalog_id","catalog_search_document_id","embedding_model");--> statement-breakpoint
CREATE INDEX "catalog_embedding_work_items_pending_scheduled_claim_idx" ON "catalog_embedding_work_items" USING btree ("catalog_id","embedding_model","scheduled_at","created_at","id") WHERE "catalog_embedding_work_items"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "catalog_embedding_work_items_provider_scheduled_pending_idx" ON "catalog_embedding_work_items" USING btree ("catalog_id","provider_id","embedding_model","scheduled_at","created_at","id") WHERE "catalog_embedding_work_items"."status" = 'pending' and "catalog_embedding_work_items"."provider_id" is not null;--> statement-breakpoint
CREATE INDEX "catalog_embedding_work_items_submitted_deadline_idx" ON "catalog_embedding_work_items" USING btree ("catalog_id","embedding_model","submitted_deadline_at","id") WHERE "catalog_embedding_work_items"."status" = 'submitted';--> statement-breakpoint
CREATE INDEX "catalog_embedding_work_items_batch_job_idx" ON "catalog_embedding_work_items" USING btree ("catalog_id","embedding_model","embedding_batch_job_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_search_documents_catalog_entry_unique" ON "catalog_search_documents" USING btree ("catalog_entry_id");--> statement-breakpoint
CREATE INDEX "catalog_search_documents_catalog_status_idx" ON "catalog_search_documents" USING btree ("catalog_id","document_status");--> statement-breakpoint
CREATE INDEX "catalog_search_documents_catalog_provider_status_idx" ON "catalog_search_documents" USING btree ("catalog_id","provider_id","document_status");--> statement-breakpoint
CREATE INDEX "catalog_search_documents_catalog_category_status_idx" ON "catalog_search_documents" USING btree ("catalog_id","category","document_status");--> statement-breakpoint
CREATE INDEX "catalog_search_documents_catalog_brand_status_idx" ON "catalog_search_documents" USING btree ("catalog_id","brand","document_status");--> statement-breakpoint
CREATE INDEX "catalog_search_documents_catalog_availability_status_idx" ON "catalog_search_documents" USING btree ("catalog_id","availability_status","document_status");--> statement-breakpoint
CREATE INDEX "catalog_search_documents_catalog_sku_status_idx" ON "catalog_search_documents" USING btree ("catalog_id","sku","document_status");--> statement-breakpoint
CREATE INDEX "catalog_search_documents_catalog_currency_status_idx" ON "catalog_search_documents" USING btree ("catalog_id","currency","document_status");--> statement-breakpoint
CREATE INDEX "catalog_search_documents_catalog_amount_status_idx" ON "catalog_search_documents" USING btree ("catalog_id","amount","document_status");--> statement-breakpoint
CREATE INDEX "catalog_search_documents_catalog_quality_status_idx" ON "catalog_search_documents" USING btree ("catalog_id","quality_tier","document_status");--> statement-breakpoint
CREATE INDEX "catalog_search_documents_catalog_updated_idx" ON "catalog_search_documents" USING btree ("catalog_id","document_status","updated_at");--> statement-breakpoint
CREATE INDEX "catalog_search_documents_active_updated_idx" ON "catalog_search_documents" USING btree ("catalog_id","updated_at","id") WHERE "catalog_search_documents"."document_status" = 'active';--> statement-breakpoint
CREATE INDEX "catalog_search_documents_provider_active_updated_idx" ON "catalog_search_documents" USING btree ("catalog_id","provider_id","updated_at","id") WHERE "catalog_search_documents"."document_status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_search_embeddings_document_model_unique" ON "catalog_search_embeddings" USING btree ("catalog_search_document_id","embedding_model");--> statement-breakpoint
CREATE INDEX "catalog_search_embeddings_catalog_model_status_idx" ON "catalog_search_embeddings" USING btree ("catalog_id","embedding_model","status");--> statement-breakpoint
CREATE INDEX "catalog_search_embeddings_ready_document_lookup_idx" ON "catalog_search_embeddings" USING btree ("catalog_id","embedding_model","catalog_search_document_id") WHERE "catalog_search_embeddings"."status" = 'ready';--> statement-breakpoint
CREATE INDEX "catalog_search_index_jobs_catalog_status_scheduled_idx" ON "catalog_search_index_jobs" USING btree ("catalog_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "catalog_search_index_jobs_catalog_type_status_idx" ON "catalog_search_index_jobs" USING btree ("catalog_id","job_type","status");--> statement-breakpoint
CREATE INDEX "catalog_search_index_jobs_catalog_status_idx" ON "catalog_search_index_jobs" USING btree ("catalog_id","status");--> statement-breakpoint
CREATE INDEX "catalog_search_index_jobs_catalog_provider_status_idx" ON "catalog_search_index_jobs" USING btree ("catalog_id","provider_id","status");--> statement-breakpoint
CREATE INDEX "catalog_search_index_jobs_catalog_provider_created_idx" ON "catalog_search_index_jobs" USING btree ("catalog_id","provider_id","created_at");--> statement-breakpoint
CREATE INDEX "catalog_search_index_jobs_pending_claim_idx" ON "catalog_search_index_jobs" USING btree ("catalog_id","scheduled_at","created_at","id") WHERE "catalog_search_index_jobs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "catalog_search_index_jobs_pending_non_embedding_claim_idx" ON "catalog_search_index_jobs" USING btree ("catalog_id","scheduled_at","created_at","id") WHERE "catalog_search_index_jobs"."status" = 'pending' and "catalog_search_index_jobs"."job_type" <> 'refresh_embedding';--> statement-breakpoint
CREATE INDEX "catalog_search_index_jobs_pending_embedding_count_idx" ON "catalog_search_index_jobs" USING btree ("catalog_id","scheduled_at") WHERE "catalog_search_index_jobs"."status" = 'pending' and "catalog_search_index_jobs"."job_type" = 'refresh_embedding';--> statement-breakpoint
CREATE INDEX "catalog_search_index_jobs_pending_embedding_document_id_idx" ON "catalog_search_index_jobs" USING btree ("catalog_id","search_document_id") WHERE "catalog_search_index_jobs"."status" in ('pending', 'running') and "catalog_search_index_jobs"."job_type" = 'refresh_embedding' and "catalog_search_index_jobs"."search_document_id" is not null;--> statement-breakpoint
CREATE INDEX "catalog_search_index_jobs_pending_embedding_claim_idx" ON "catalog_search_index_jobs" USING btree ("catalog_id","scheduled_at","created_at","id") WHERE "catalog_search_index_jobs"."status" = 'pending' and "catalog_search_index_jobs"."job_type" = 'refresh_embedding' and "catalog_search_index_jobs"."search_document_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_search_index_jobs_catalog_dedupe_unique" ON "catalog_search_index_jobs" USING btree ("catalog_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "catalog_search_index_jobs_queue_trend_created_idx" ON "catalog_search_index_jobs" USING btree ("catalog_id","created_at","job_type");--> statement-breakpoint
CREATE INDEX "catalog_search_index_jobs_queue_trend_finished_idx" ON "catalog_search_index_jobs" USING btree ("catalog_id","finished_at","status","job_type") WHERE "catalog_search_index_jobs"."finished_at" is not null and "catalog_search_index_jobs"."status" in ('completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE INDEX "catalog_search_index_jobs_completed_cleanup_idx" ON "catalog_search_index_jobs" USING btree ("catalog_id","finished_at","id") WHERE "catalog_search_index_jobs"."status" = 'completed' and "catalog_search_index_jobs"."finished_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_search_reconcile_checkpoints_catalog_kind_unique" ON "catalog_search_reconcile_checkpoints" USING btree ("catalog_id","reconcile_kind");--> statement-breakpoint
CREATE INDEX "catalog_search_reconcile_checkpoints_status_updated_idx" ON "catalog_search_reconcile_checkpoints" USING btree ("catalog_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "catalog_search_documents_search_vector_idx" ON "catalog_search_documents" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "catalog_search_embeddings_embedding_hnsw_64_idx" ON "catalog_search_embeddings" USING hnsw (("embedding_vector_pg"::vector(64)) vector_cosine_ops) WHERE ("status" = 'ready' AND "embedding_dimension" = 64 AND "embedding_vector_pg" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "catalog_search_embeddings_embedding_hnsw_1024_idx" ON "catalog_search_embeddings" USING hnsw (("embedding_vector_pg"::vector(1024)) vector_cosine_ops) WHERE ("status" = 'ready' AND "embedding_dimension" = 1024 AND "embedding_vector_pg" IS NOT NULL);
