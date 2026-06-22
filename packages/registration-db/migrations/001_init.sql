CREATE TABLE "catalog_health_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"registration_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"checked_url" text NOT NULL,
	"check_type" text DEFAULT 'query_probe' NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer,
	"error" text,
	"response_payload" jsonb,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_index_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"registration_id" text NOT NULL,
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
	"registration_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"catalog_registration_id" text NOT NULL,
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
	"registration_id" text NOT NULL,
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
	"registration_id" text NOT NULL,
	"request_payload" jsonb NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"requester_key_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_verification_records" (
	"id" text PRIMARY KEY NOT NULL,
	"registration_id" text NOT NULL,
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
	"registration_id" text NOT NULL,
	"catalog_id" text NOT NULL,
	"active_registration_id" text,
	"active_registration_version" integer,
	"active_snapshot_id" text,
	"status" text DEFAULT 'pending_verification' NOT NULL,
	"verification_status" text DEFAULT 'challenge_required' NOT NULL,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"health_failure_count" integer DEFAULT 0 NOT NULL,
	"last_healthy_at" timestamp with time zone,
	"last_unhealthy_at" timestamp with time zone,
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
CREATE INDEX "catalog_health_checks_catalog_idx" ON "catalog_health_checks" USING btree ("registration_id","catalog_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_index_entries_registration_catalog_unique" ON "catalog_index_entries" USING btree ("registration_id","catalog_id");--> statement-breakpoint
CREATE INDEX "catalog_index_entries_status_idx" ON "catalog_index_entries" USING btree ("registration_id","entry_status","verification_status");--> statement-breakpoint
CREATE INDEX "catalog_manifest_snapshots_catalog_idx" ON "catalog_manifest_snapshots" USING btree ("registration_id","catalog_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_registration_records_version_unique" ON "catalog_registration_records" USING btree ("registration_id","catalog_id","registration_version");--> statement-breakpoint
CREATE INDEX "catalog_registration_records_catalog_idx" ON "catalog_registration_records" USING btree ("registration_id","catalog_id");--> statement-breakpoint
CREATE INDEX "catalog_search_audit_records_registration_created_idx" ON "catalog_search_audit_records" USING btree ("registration_id","created_at");--> statement-breakpoint
CREATE INDEX "catalog_verification_records_catalog_idx" ON "catalog_verification_records" USING btree ("registration_id","catalog_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registered_catalogs_registration_catalog_unique" ON "registered_catalogs" USING btree ("registration_id","catalog_id");--> statement-breakpoint
CREATE INDEX "registered_catalogs_status_idx" ON "registered_catalogs" USING btree ("registration_id","status","verification_status");