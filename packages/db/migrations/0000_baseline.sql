CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."entry_status" AS ENUM('active', 'inactive', 'rejected', 'pending_verification');--> statement-breakpoint
CREATE TYPE "public"."object_sync_batch_status" AS ENUM('accepted', 'partial', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."object_sync_item_status" AS ENUM('accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."provider_contract_state_status" AS ENUM('active', 'inactive', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('accepted_full', 'accepted_limited', 'rejected', 'pending_verification');--> statement-breakpoint
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
CREATE TABLE "catalog_entry_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"catalog_entry_id" text NOT NULL,
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
CREATE TABLE "object_sync_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"registration_version" integer NOT NULL,
	"batch_id" text NOT NULL,
	"status" "object_sync_batch_status" DEFAULT 'rejected' NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"request_payload" jsonb NOT NULL,
	"result_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "object_sync_item_results" (
	"id" text PRIMARY KEY NOT NULL,
	"sync_batch_id" text NOT NULL,
	"object_id" text,
	"status" "object_sync_item_status" NOT NULL,
	"commercial_object_id" text,
	"catalog_entry_id" text,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "provider_products" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"sku" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"brand" text NOT NULL,
	"category" text NOT NULL,
	"product_url" text NOT NULL,
	"image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"currency" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"availability_status" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"run_type" text NOT NULL,
	"target_product_id" text,
	"registration_version" integer,
	"status" text NOT NULL,
	"request_payload" jsonb,
	"result_payload" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "catalog_health_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"center_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"checked_url" text NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer,
	"error" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_index_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"center_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"active_snapshot_id" text NOT NULL,
	"entry_status" text DEFAULT 'active' NOT NULL,
	"catalog_name" text NOT NULL,
	"description" text,
	"homepage" text NOT NULL,
	"manifest_url" text NOT NULL,
	"well_known_url" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supported_object_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supported_query_modes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supported_query_packs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supported_query_languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content_languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"supports_resolve" integer DEFAULT 0 NOT NULL,
	"verification_status" text NOT NULL,
	"trust_tier" text NOT NULL,
	"health_status" text NOT NULL,
	"search_projection" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"explain_projection" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_manifest_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"center_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"registration_id" text NOT NULL,
	"manifest_url" text NOT NULL,
	"discovery_payload" jsonb NOT NULL,
	"manifest_payload" jsonb NOT NULL,
	"manifest_hash" text NOT NULL,
	"supported_object_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"query_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"object_contract_summaries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_registration_records" (
	"id" text PRIMARY KEY NOT NULL,
	"center_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"registration_version" integer NOT NULL,
	"status" text NOT NULL,
	"registration_payload" jsonb NOT NULL,
	"result_payload" jsonb,
	"source_ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_search_audit_records" (
	"id" text PRIMARY KEY NOT NULL,
	"center_id" text NOT NULL,
	"request_payload" jsonb NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"requester_key_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_verification_records" (
	"id" text PRIMARY KEY NOT NULL,
	"center_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"challenge_type" text NOT NULL,
	"challenge_payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"verified_domain" text,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registered_catalogs" (
	"id" text PRIMARY KEY NOT NULL,
	"center_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"active_registration_id" text,
	"active_registration_version" integer,
	"active_snapshot_id" text,
	"status" text DEFAULT 'pending_verification' NOT NULL,
	"verification_status" text DEFAULT 'challenge_required' NOT NULL,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"trust_tier" text DEFAULT 'unverified' NOT NULL,
	"catalog_access_token_hash" text,
	"token_issued_at" timestamp with time zone,
	"homepage" text NOT NULL,
	"well_known_url" text NOT NULL,
	"claimed_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"operator" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_entries" ADD CONSTRAINT "catalog_entries_commercial_object_id_commercial_objects_id_fk" FOREIGN KEY ("commercial_object_id") REFERENCES "public"."commercial_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_entry_embeddings" ADD CONSTRAINT "catalog_entry_embeddings_catalog_entry_id_catalog_entries_id_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."catalog_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "descriptor_instances" ADD CONSTRAINT "descriptor_instances_commercial_object_id_commercial_objects_id_fk" FOREIGN KEY ("commercial_object_id") REFERENCES "public"."commercial_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sync_item_results" ADD CONSTRAINT "object_sync_item_results_sync_batch_id_object_sync_batches_id_fk" FOREIGN KEY ("sync_batch_id") REFERENCES "public"."object_sync_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sync_item_results" ADD CONSTRAINT "object_sync_item_results_commercial_object_id_commercial_objects_id_fk" FOREIGN KEY ("commercial_object_id") REFERENCES "public"."commercial_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_sync_item_results" ADD CONSTRAINT "object_sync_item_results_catalog_entry_id_catalog_entries_id_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."catalog_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_contract_states" ADD CONSTRAINT "provider_contract_states_active_registration_id_provider_registrations_id_fk" FOREIGN KEY ("active_registration_id") REFERENCES "public"."provider_registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolvable_references" ADD CONSTRAINT "resolvable_references_commercial_object_id_commercial_objects_id_fk" FOREIGN KEY ("commercial_object_id") REFERENCES "public"."commercial_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolvable_references" ADD CONSTRAINT "resolvable_references_catalog_entry_id_catalog_entries_id_fk" FOREIGN KEY ("catalog_entry_id") REFERENCES "public"."catalog_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_entries_catalog_type_status_idx" ON "catalog_entries" USING btree ("catalog_id","object_type","entry_status");--> statement-breakpoint
CREATE INDEX "catalog_entries_catalog_provider_status_idx" ON "catalog_entries" USING btree ("catalog_id","provider_id","entry_status");--> statement-breakpoint
CREATE INDEX "catalog_entries_catalog_category_status_idx" ON "catalog_entries" USING btree ("catalog_id","category","entry_status");--> statement-breakpoint
CREATE INDEX "catalog_entries_catalog_brand_status_idx" ON "catalog_entries" USING btree ("catalog_id","brand","entry_status");--> statement-breakpoint
CREATE INDEX "catalog_entries_catalog_availability_status_idx" ON "catalog_entries" USING btree ("catalog_id","availability_status","entry_status");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_entries_commercial_object_unique" ON "catalog_entries" USING btree ("commercial_object_id");--> statement-breakpoint
CREATE INDEX "catalog_entries_search_text_trgm_idx" ON "catalog_entries" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_entry_embeddings_entry_model_unique" ON "catalog_entry_embeddings" USING btree ("catalog_entry_id","embedding_model");--> statement-breakpoint
CREATE INDEX "catalog_entry_embeddings_catalog_model_status_idx" ON "catalog_entry_embeddings" USING btree ("catalog_id","embedding_model","status");--> statement-breakpoint
CREATE INDEX "catalog_entry_embeddings_catalog_model_status_entry_idx" ON "catalog_entry_embeddings" USING btree ("catalog_id","embedding_model","status","catalog_entry_id");--> statement-breakpoint
CREATE INDEX "catalog_entry_embeddings_embedding_hnsw_64_idx" ON "catalog_entry_embeddings" USING hnsw (("embedding_vector_pg"::vector(64)) vector_cosine_ops) WHERE ("status" = 'ready' AND "embedding_dimension" = 64 AND "embedding_vector_pg" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "catalog_entry_embeddings_embedding_hnsw_1024_idx" ON "catalog_entry_embeddings" USING hnsw (("embedding_vector_pg"::vector(1024)) vector_cosine_ops) WHERE ("status" = 'ready' AND "embedding_dimension" = 1024 AND "embedding_vector_pg" IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_profiles_catalog_id_unique" ON "catalog_profiles" USING btree ("catalog_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commercial_objects_provider_object_unique" ON "commercial_objects" USING btree ("catalog_id","provider_id","object_id");--> statement-breakpoint
CREATE INDEX "commercial_objects_catalog_type_idx" ON "commercial_objects" USING btree ("catalog_id","object_type");--> statement-breakpoint
CREATE INDEX "descriptor_instances_object_pack_idx" ON "descriptor_instances" USING btree ("commercial_object_id","pack_id");--> statement-breakpoint
CREATE UNIQUE INDEX "object_contracts_catalog_contract_unique" ON "object_contracts" USING btree ("catalog_id","contract_id");--> statement-breakpoint
CREATE INDEX "object_contracts_catalog_object_type_idx" ON "object_contracts" USING btree ("catalog_id","object_type");--> statement-breakpoint
CREATE UNIQUE INDEX "object_sync_batches_provider_batch_unique" ON "object_sync_batches" USING btree ("catalog_id","provider_id","batch_id");--> statement-breakpoint
CREATE INDEX "object_sync_batches_provider_created_idx" ON "object_sync_batches" USING btree ("catalog_id","provider_id","created_at");--> statement-breakpoint
CREATE INDEX "object_sync_item_results_batch_idx" ON "object_sync_item_results" USING btree ("sync_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_contract_states_provider_unique" ON "provider_contract_states" USING btree ("catalog_id","provider_id");--> statement-breakpoint
CREATE INDEX "provider_contract_states_active_registration_idx" ON "provider_contract_states" USING btree ("active_registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_registrations_provider_version_unique" ON "provider_registrations" USING btree ("catalog_id","provider_id","registration_version");--> statement-breakpoint
CREATE INDEX "provider_registrations_provider_idx" ON "provider_registrations" USING btree ("catalog_id","provider_id");--> statement-breakpoint
CREATE INDEX "query_audit_records_catalog_created_idx" ON "query_audit_records" USING btree ("catalog_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_products_provider_sku_unique" ON "provider_products" USING btree ("provider_id","sku");--> statement-breakpoint
CREATE INDEX "provider_products_provider_status_idx" ON "provider_products" USING btree ("provider_id","status");--> statement-breakpoint
CREATE INDEX "provider_sync_runs_provider_created_idx" ON "provider_sync_runs" USING btree ("provider_id","created_at");--> statement-breakpoint
CREATE INDEX "catalog_health_checks_catalog_idx" ON "catalog_health_checks" USING btree ("center_id","catalog_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_index_entries_center_catalog_unique" ON "catalog_index_entries" USING btree ("center_id","catalog_id");--> statement-breakpoint
CREATE INDEX "catalog_index_entries_status_idx" ON "catalog_index_entries" USING btree ("center_id","entry_status","verification_status");--> statement-breakpoint
CREATE INDEX "catalog_manifest_snapshots_catalog_idx" ON "catalog_manifest_snapshots" USING btree ("center_id","catalog_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_registration_records_version_unique" ON "catalog_registration_records" USING btree ("center_id","catalog_id","registration_version");--> statement-breakpoint
CREATE INDEX "catalog_registration_records_catalog_idx" ON "catalog_registration_records" USING btree ("center_id","catalog_id");--> statement-breakpoint
CREATE INDEX "catalog_search_audit_records_center_created_idx" ON "catalog_search_audit_records" USING btree ("center_id","created_at");--> statement-breakpoint
CREATE INDEX "catalog_verification_records_catalog_idx" ON "catalog_verification_records" USING btree ("center_id","catalog_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registered_catalogs_center_catalog_unique" ON "registered_catalogs" USING btree ("center_id","catalog_id");--> statement-breakpoint
CREATE INDEX "registered_catalogs_status_idx" ON "registered_catalogs" USING btree ("center_id","status","verification_status");
