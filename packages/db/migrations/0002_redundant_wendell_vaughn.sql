CREATE TYPE "public"."ocp_activity_public_visibility" AS ENUM('public', 'aggregate_only', 'private');--> statement-breakpoint
CREATE TABLE "ocp_activity_public_events" (
	"id" text PRIMARY KEY NOT NULL,
	"raw_event_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"event_type" text NOT NULL,
	"source_kind" text NOT NULL,
	"client_kind" text NOT NULL,
	"protocol_family" text NOT NULL,
	"catalog_id" text,
	"provider_id" text,
	"object_type" text,
	"status_class" text NOT NULL,
	"duration_bucket" text NOT NULL,
	"result_count_bucket" text NOT NULL,
	"public_summary" text NOT NULL,
	"correlation_id_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ocp_activity_events_raw" (
	"id" text PRIMARY KEY NOT NULL,
	"event_version" text NOT NULL,
	"event_type" text NOT NULL,
	"idempotency_key" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" text,
	"trace_id" text,
	"span_id" text,
	"parent_event_id" text,
	"source_kind" text NOT NULL,
	"client_kind" text NOT NULL,
	"endpoint_role" text NOT NULL,
	"protocol_family" text NOT NULL,
	"protocol_version" text,
	"method" text,
	"path_template" text,
	"status_code" integer,
	"duration_ms" integer,
	"error_code" text,
	"registration_id" text,
	"catalog_id" text,
	"provider_id" text,
	"object_type" text,
	"query_pack" text,
	"capability_id" text,
	"result_count" integer,
	"sync_object_count" integer,
	"public_visibility" "ocp_activity_public_visibility" DEFAULT 'aggregate_only' NOT NULL,
	"redaction_policy_version" text NOT NULL,
	"payload_hash" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ocp_activity_public_events" ADD CONSTRAINT "ocp_activity_public_events_raw_event_id_ocp_activity_events_raw_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."ocp_activity_events_raw"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ocp_activity_public_events_raw_unique" ON "ocp_activity_public_events" USING btree ("raw_event_id");--> statement-breakpoint
CREATE INDEX "ocp_activity_public_events_occurred_idx" ON "ocp_activity_public_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "ocp_activity_public_events_type_occurred_idx" ON "ocp_activity_public_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "ocp_activity_public_events_protocol_occurred_idx" ON "ocp_activity_public_events" USING btree ("protocol_family","occurred_at");--> statement-breakpoint
CREATE INDEX "ocp_activity_public_events_catalog_occurred_idx" ON "ocp_activity_public_events" USING btree ("catalog_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ocp_activity_events_raw_idempotency_unique" ON "ocp_activity_events_raw" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ocp_activity_events_raw_type_occurred_idx" ON "ocp_activity_events_raw" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "ocp_activity_events_raw_protocol_occurred_idx" ON "ocp_activity_events_raw" USING btree ("protocol_family","occurred_at");--> statement-breakpoint
CREATE INDEX "ocp_activity_events_raw_catalog_occurred_idx" ON "ocp_activity_events_raw" USING btree ("catalog_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ocp_activity_events_raw_provider_occurred_idx" ON "ocp_activity_events_raw" USING btree ("provider_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ocp_activity_events_raw_correlation_idx" ON "ocp_activity_events_raw" USING btree ("correlation_id");